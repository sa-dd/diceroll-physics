import { AdsgramInitParams, AdController } from "@/shared";

declare global {
  interface Window {
    Adsgram?: {
      init(params: AdsgramInitParams): AdController;
    };
  }
}

export {};
