// hooks/useWindowResize.ts
import { useEffect } from "react";

export const useWindowResize = (handler: () => void) => {
  useEffect(() => {
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [handler]);
};
