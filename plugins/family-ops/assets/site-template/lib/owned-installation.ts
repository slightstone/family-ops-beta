import {env} from 'cloudflare:workers';

const keys=['FAMILY_OPS_INSTALLATION_KIND','FAMILY_OPS_INSTALLATION_OWNER_ID','FAMILY_OPS_INSTALLATION_ID'] as const;
export type OwnedInstallation={kind:'shared'}|{kind:'invalid-owned'}|{kind:'owned';ownerId:string;installationId:string};

/** Trusted runtime metadata only. Partial declarations never fall back to shared authority. */
export function ownedInstallation():OwnedInstallation{
 const values=env as unknown as Record<string,unknown>;
 if(!keys.some(key=>Object.hasOwn(values,key)))return {kind:'shared'};
 const owner=values.FAMILY_OPS_INSTALLATION_OWNER_ID,id=values.FAMILY_OPS_INSTALLATION_ID;
 if(values.FAMILY_OPS_INSTALLATION_KIND!=='customer-owned-v1'||typeof owner!=='string'||!owner.length||owner.length>200||[...owner].some(c=>/\s/u.test(c)||c.charCodeAt(0)<32||c.charCodeAt(0)===127)||typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id))return {kind:'invalid-owned'};
 return {kind:'owned',ownerId:owner,installationId:id.toLowerCase()};
}
