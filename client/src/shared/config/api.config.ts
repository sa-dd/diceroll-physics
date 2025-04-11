import { ENV } from "@/shared";

const SERVER_URL = ENV.API_URL;

export const API_URL = {
  root: SERVER_URL,
  auth: `${SERVER_URL}/auth`,
  friend: `${SERVER_URL}/friend`,
  leader: `${SERVER_URL}/leader`,
  task: `${SERVER_URL}/task`,
  user: `${SERVER_URL}/user`,
  roll: `${SERVER_URL}/roll`,
  history: `${SERVER_URL}/history`,
  balance: `${SERVER_URL}/balance`,
};
