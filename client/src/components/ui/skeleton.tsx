import { cn } from "@/shared";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-dark-2", className)}
      {...props}
    />
  );
}

export { Skeleton };
