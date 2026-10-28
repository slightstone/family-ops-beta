import {requireChatGPTUser} from '../chatgpt-auth';
import WorkspaceApp from './workspace';
export const dynamic='force-dynamic';
export default async function FamilyApp(){await requireChatGPTUser('/app');return <WorkspaceApp/>;}
