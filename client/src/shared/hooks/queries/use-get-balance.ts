"use client";

import { getBalance } from "@/shared/services/balance";
import { IBalance } from "@/shared/types";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export const useGetBalance = (initialData?: IBalance) => {
  const { data, isLoading } = useQuery({
    queryKey: ["balance"],
    queryFn: () => getBalance(),
    initialData,
  });

  return useMemo(
    () => ({
      data,
      isLoading,
    }),
    [data, isLoading]
  );
};
