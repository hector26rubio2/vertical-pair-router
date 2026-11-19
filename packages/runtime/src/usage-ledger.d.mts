export function usageDirectory():string;
export function accountKey(provider:string,identity:string|null|undefined):Promise<string|null>;
export function recordUsage(input:Record<string,unknown>):Promise<Record<string,unknown>>;
export function readUsage(input?:{sessionId?:string;account?:string;scope?:string;detail?:boolean}):Promise<any>;
export function formatUsage(input:any):string;
export function recordAccountObservation(input:Record<string,unknown>):Promise<void>;
export function readAccountObservation(account:string|null|undefined):Promise<any>;
