import { intervalToDuration } from "date-fns";

export const formatInterval = (available: Date): string => {
  if (!available) return "";

  const now = new Date();
  const availableAt = new Date(available);

  const duration = intervalToDuration({ start: now, end: availableAt });

  const totalHours = (duration.days || 0) * 24 + (duration.hours || 0);
  const minutes = duration.minutes || 0;
  const seconds = duration.seconds || 0;

  let formattedTime = `${totalHours || 0}:${minutes || 0}:${seconds || 0}`;

  if (minutes < 10)
    formattedTime = formattedTime.replace(`${minutes}`, `0${minutes}`);
  if (seconds < 10)
    formattedTime = formattedTime.replace(`${seconds}`, `0${seconds}`);

  return formattedTime;
};
