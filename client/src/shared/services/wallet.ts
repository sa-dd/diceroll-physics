// import { ConnectWalletType } from "@/components";
// import { getAccessToken } from "@/shared/utils";
// import { revalidateTag } from "next/cache";
// import { API_URL } from "../config";
// import { getLocale } from "@/core/i18n/locale";

// export const connectWallet = async (
//   data: ConnectWalletType
// ): Promise<{ ok: true }> => {
//   const response = await fetch(API_URL.wallet("/connect"), {
//     method: "POST",
//     body: JSON.stringify(data),
//     headers: {
//       "Content-Type": "application/json",
//       Authorization: await getAccessToken(),
//       "Accept-Language": await getLocale(),
//     },
//   });

//   const result = await response.json();

//   if (!response.ok) {
//     throw new Error("Failed to connect wallet");
//   }

//   revalidateTag("user");

//   return result;
// };

// export const disconnectWallet = async (): Promise<{ ok: true }> => {
//   const response = await fetch(API_URL.wallet("/disconnect"), {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Authorization: await getAccessToken(),
//       "Accept-Language": await getLocale(),
//     },
//   });

//   const result = await response.json();

//   if (!response.ok) {
//     throw new Error("Failed to disconnect wallet");
//   }

//   revalidateTag("user");

//   return result;
// };
