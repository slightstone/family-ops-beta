import {env} from 'cloudflare:workers';
import {KidsError} from './kids';
import {ownedInstallation} from './owned-installation';
export const KIDS_HOSTED_CONSENT='unipile-v2-2026-10-23';
export const kidsHostedAccountAlias=(bindingId:string)=>'hosted:'+bindingId;
export const kidsHostedSelfAlias=(bindingId:string)=>'hosted-self:'+bindingId;
type Config={DB:D1Database;FAMILY_OPS_KIDS_LIVE?:string;FAMILY_OPS_KIDS_HOSTED_SOURCE?:string;FAMILY_OPS_KIDS_HOSTED_TRANSPORT?:string;UNIPILE_APPLICATION_ID?:string;UNIPILE_ENVIRONMENT?:string;UNIPILE_WEBHOOK_ENDPOINT_ID?:string;UNIPILE_WEBHOOK_SECRET?:string;UNIPILE_API_KEY?:string;FAMILY_OPS_SOURCE_IDENTITY_KEY?:string;FAMILY_OPS_PUBLIC_ORIGIN?:string};
export function kidsHostedConfig(cleanup=false){
 const c=env as unknown as Config;
 if(!cleanup&&(c.FAMILY_OPS_KIDS_LIVE!=='enabled'||c.FAMILY_OPS_KIDS_HOSTED_SOURCE!=='unipile-v2'))throw new KidsError('Hosted Kids sources are not enabled.',503);
 if(!c.DB||!c.UNIPILE_APPLICATION_ID||!['test','production'].includes(c.UNIPILE_ENVIRONMENT??''))throw new KidsError('Hosted source verification is unavailable.',503);
 const declared=Object.hasOwn(c,'FAMILY_OPS_KIDS_HOSTED_TRANSPORT'),mode=ownedInstallation();
 if(declared&&c.FAMILY_OPS_KIDS_HOSTED_TRANSPORT!=='poll'&&c.FAMILY_OPS_KIDS_HOSTED_TRANSPORT!=='webhook')throw new KidsError('Hosted source transport is unavailable.',503);
 if(c.FAMILY_OPS_KIDS_HOSTED_TRANSPORT==='poll'){
  if(mode.kind!=='owned')throw new KidsError('Private polling needs a complete customer-owned installation.',503);
  return {...c,UNIPILE_APPLICATION_ID:c.UNIPILE_APPLICATION_ID,transport:'poll' as const,channelId:'poll:'+mode.installationId,webhookSecret:null};
 }
 if(!c.UNIPILE_WEBHOOK_ENDPOINT_ID||c.UNIPILE_WEBHOOK_ENDPOINT_ID.startsWith('poll:')||!c.UNIPILE_WEBHOOK_SECRET)throw new KidsError('Hosted source verification is unavailable.',503);
 return {...c,UNIPILE_APPLICATION_ID:c.UNIPILE_APPLICATION_ID,transport:'webhook' as const,channelId:c.UNIPILE_WEBHOOK_ENDPOINT_ID,webhookSecret:c.UNIPILE_WEBHOOK_SECRET};
}
