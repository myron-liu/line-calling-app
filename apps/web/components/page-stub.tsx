import type { ReactNode } from "react";

// Placeholder scaffold for a not-yet-built screen. Each stub names the design-doc
// section it implements and lists the pieces still to build.
export function PageStub({
  title,
  section,
  children,
  todo,
}: {
  title: string;
  section: string;
  children?: ReactNode;
  todo?: string[];
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <span className="text-xs uppercase tracking-wide text-faint">
          {section}
        </span>
      </div>
      {children}
      {todo && todo.length > 0 && (
        <div className="rounded-lg border border-dashed border-line-strong p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
            To build
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {todo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
