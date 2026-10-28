import {requireChatGPTUser} from '../chatgpt-auth';
import {sharingEnabled} from '../../lib/family-sharing';
import JoinInvitation from './join-invitation';
import {Brand} from '../ui';
export const dynamic='force-dynamic';
export default async function JoinPage(){await requireChatGPTUser('/join');return <main className="join-page"><Brand/>{sharingEnabled()?<JoinInvitation/>:<section className="section-card"><h1>Adult sharing is not open yet.</h1><p>Your existing workspace is unchanged. The owner will let you know when invitations are available.</p><a className="button" href="/app">Open your workspace</a></section>}</main>;}
