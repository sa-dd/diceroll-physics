export const ENV: { [key: string]: string } = {
  API_URL: process.env.API_URL as string,
  ASSETS_URL: process.env.NEXT_PUBLIC_ASSETS_URL as string,
  NODE_ENV: process.env.NEXT_PUBLIC_ENV as string,
};
