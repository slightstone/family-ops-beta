import {KidsError} from './kids-error';
import {hostedDiscoveryInput,retryKidsHostedDiscovery,readKids} from './kids-store';
import {collectChatTitlesInput,collectKidsChatTitles} from './kids-chat-catalog';

// Old successful operations remain replayable; there is only one live collector.
export async function discoverKidsHostedChats(user:string,input:unknown){
 const legacy=hostedDiscoveryInput.safeParse(input);
 if(legacy.success){const saved=await retryKidsHostedDiscovery(user,legacy.data);if(saved)return saved;throw new KidsError('Reopen WhatsApp setup to use the resumable title scan. Earlier choices are kept.',409);}
 const valid=collectChatTitlesInput.safeParse(input);if(!valid.success)throw new KidsError('Check the title-scan request.');
 const result=await collectKidsChatTitles(user,valid.data,'web');
 return {...await readKids(user),titleDiscovery:result};
}
