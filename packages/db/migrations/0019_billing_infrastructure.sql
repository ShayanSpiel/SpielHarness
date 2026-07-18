-- Billing infrastructure readiness
-- Adds billing_accounts, plans, entitlements, credit_reservations tables
-- and transactional credit functions.

-- Provider customer IDs per org
CREATE TABLE IF NOT EXISTS billing_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider    text NOT NULL,
  customer_id text NOT NULL,
  metadata    jsonb DEFAULT '{}',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(org_id, provider)
);

-- Plan definitions
CREATE TABLE IF NOT EXISTS plans (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  price_cents        integer NOT NULL DEFAULT 0,
  interval           text NOT NULL DEFAULT 'month',
  credits_included   bigint NOT NULL DEFAULT 0,
  features           jsonb DEFAULT '{}',
  enabled            boolean DEFAULT true,
  created_at         timestamptz DEFAULT now()
);

-- Org-to-plan mapping
CREATE TABLE IF NOT EXISTS entitlements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  plan_id            text NOT NULL REFERENCES plans(id),
  status             text NOT NULL DEFAULT 'active',
  current_period_end timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now(),
  UNIQUE(org_id)
);

-- Credit reservations for run execution
CREATE TABLE IF NOT EXISTS credit_reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  run_id      uuid,
  amount      bigint NOT NULL,
  status      text NOT NULL DEFAULT 'reserved',
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  settled_amount bigint,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_reservations_org_status ON credit_reservations(org_id, status);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_expires ON credit_reservations(expires_at) WHERE status = 'reserved';

-- Transactional credit reservation function
CREATE OR REPLACE FUNCTION reserve_credits(
  p_org_id uuid,
  p_amount bigint,
  p_run_id uuid DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_reservation_id uuid;
  v_balance bigint;
BEGIN
  SELECT balance INTO v_balance FROM org_credits WHERE org_id = p_org_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'No credit account found for org %', p_org_id;
  END IF;
  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient credits: have %, need %', v_balance, p_amount;
  END IF;
  UPDATE org_credits SET balance = balance - p_amount WHERE org_id = p_org_id;
  INSERT INTO credit_reservations (org_id, run_id, amount, status)
    VALUES (p_org_id, p_run_id, p_amount, 'reserved')
    RETURNING id INTO v_reservation_id;
  INSERT INTO credit_transactions (org_id, amount, reason, run_id)
    VALUES (p_org_id, -p_amount, 'reservation', p_run_id);
  RETURN v_reservation_id;
END;
$$ LANGUAGE plpgsql;

-- Settle a reservation with actual cost
CREATE OR REPLACE FUNCTION settle_reservation(
  p_reservation_id uuid,
  p_actual_amount bigint
) RETURNS void AS $$
DECLARE
  v_org_id uuid;
  v_reserved bigint;
  v_diff bigint;
BEGIN
  SELECT org_id, amount INTO v_org_id, v_reserved
    FROM credit_reservations WHERE id = p_reservation_id AND status = 'reserved' FOR UPDATE;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Reservation % not found or already settled', p_reservation_id;
  END IF;
  UPDATE credit_reservations
    SET status = 'settled', settled_amount = p_actual_amount, updated_at = now()
    WHERE id = p_reservation_id;
  v_diff := v_reserved - p_actual_amount;
  IF v_diff > 0 THEN
    UPDATE org_credits SET balance = balance + v_diff WHERE org_id = v_org_id;
    INSERT INTO credit_transactions (org_id, amount, reason)
      VALUES (v_org_id, v_diff, 'reservation_release');
  ELSIF v_diff < 0 THEN
    UPDATE org_credits SET balance = balance - abs(v_diff) WHERE org_id = v_org_id;
    INSERT INTO credit_transactions (org_id, amount, reason)
      VALUES (v_org_id, v_diff, 'reservation_adjustment');
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Release expired reservations
CREATE OR REPLACE FUNCTION release_expired_reservations() RETURNS integer AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE credit_reservations SET status = 'expired', updated_at = now()
    WHERE status = 'reserved' AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Calculate cost from model rates and token counts
CREATE OR REPLACE FUNCTION calculate_cost_micros(
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_input_cost_per_1k bigint DEFAULT 0,
  p_output_cost_per_1k bigint DEFAULT 0
) RETURNS bigint AS $$
BEGIN
  RETURN (p_input_tokens * p_input_cost_per_1k / 1000)
       + (p_output_tokens * p_output_cost_per_1k / 1000);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
