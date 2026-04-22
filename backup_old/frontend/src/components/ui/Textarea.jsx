// src/components/ui/textarea.jsx
import * as React from "react";

const Textarea = React.forwardRef(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={`w-full rounded border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
