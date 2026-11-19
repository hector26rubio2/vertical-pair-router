export function prepareGuardedClaude(executable:string,args:readonly string[]):Promise<{args:string[];env:NodeJS.ProcessEnv;policy:string;buildHash:string;plugin:string}>;
