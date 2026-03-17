import axios from 'axios';

export const GOLF_API_HOST = 'live-golf-data.p.rapidapi.com';
export const DEFAULT_ORG_ID = '1';

export const getApiKey = (): string => {
    return process.env.RAPIDAPI_API_KEY || '';
};

export const getHeaders = (): Record<string, string> => {
    const key = getApiKey();
    if (!key) {
        throw new Error('RapidAPI key is not configured in environment variables.');
    }
    return {
        'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': GOLF_API_HOST
    };
};

export const sleep = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

export { axios };
