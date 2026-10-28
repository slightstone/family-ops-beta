import {requireChatGPTUser} from '../../chatgpt-auth';
import InvitationEntry from './invitation-entry';
import '../kids.css';import '../board.css';
export const dynamic='force-dynamic';
export const metadata={title:'Join a family organizer',referrer:'no-referrer'};
export default async function Join(){await requireChatGPTUser('/kids/join');return <InvitationEntry/>;}
