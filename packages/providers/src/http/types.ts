import type { Connection, ConnectionOperation, Skill } from "@spielos/core";

export interface HttpAdapter {
  execute(req: HttpRequest): Promise<HttpResponse>;
}

export type HttpRequest = {
  operation: ConnectionOperation;
  connection: Connection;
  skill: Skill;
  input: string;
  signal?: AbortSignal;
};

export type HttpResponse = {
  output: string;
};
