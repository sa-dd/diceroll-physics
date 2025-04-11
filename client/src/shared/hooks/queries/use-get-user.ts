"use client";

import { getProfile } from "@/shared/services/user";
import { IUser } from "@/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export const useGetUser = (initialData?: IUser) => {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["user"],
    queryFn: () => getProfile(),
    initialData,
  });

  return useMemo(
    () => ({
      data,
      isLoading,
      refetch,
    }),
    [data, isLoading, refetch]
  );
};
