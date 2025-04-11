"use client";

import { checkTask, startTask } from "@/shared/services/task";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import toast from "react-hot-toast";

export const useTaskAction = (id: number) => {
  const queryClient = useQueryClient();

  const { mutate: handleStartTask, isPending: isStartLoading } = useMutation({
    mutationKey: ["start task"],
    mutationFn: () => startTask(id),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError() {
      toast.error("Oopss... Failed to start task.");
    },
  });

  const { mutate: handleCheckTask, isPending: isCheckLoading } = useMutation({
    mutationKey: ["check task"],
    mutationFn: () => checkTask(id),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError() {
      toast.error("Oopss... Failed to check task.");
    },
  });

  return useMemo(
    () => ({
      handleStartTask,
      handleCheckTask,
      isStartLoading,
      isCheckLoading,
    }),
    [handleStartTask, handleCheckTask, isStartLoading, isCheckLoading]
  );
};
