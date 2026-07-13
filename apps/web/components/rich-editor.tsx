import { MentionTextarea } from "./mention-textarea";

export { MentionTextarea };

export function RichEditor({
  className,
  value,
  onChange,
  mono,
  density = "editor"
}: {
  className?: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  density?: "editor" | "field";
}) {
  return (
    <MentionTextarea className={className} density={density} mono={mono} onChange={onChange} value={value} />
  );
}
