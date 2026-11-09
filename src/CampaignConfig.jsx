import { createContext, useContext } from "react";
import config from "../config/letter.config.js";
export const CampaignConfig = createContext(config);
export const useCampaignConfig = () => useContext(CampaignConfig);

export const CampaignApi = createContext(null);
export const useCampaignApi = () => useContext(CampaignApi);
