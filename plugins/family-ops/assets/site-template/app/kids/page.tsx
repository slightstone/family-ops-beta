import {requireChatGPTUser} from '../chatgpt-auth';
import KidsApp from './kids-app';
import './kids.css';
import './board.css';
export const metadata={title:'Family Ops Kids',description:'School, activities, celebrations and preparation in one private family board.',manifest:'/kids.webmanifest',appleWebApp:{capable:true,statusBarStyle:'default',title:'Family Ops Kids'}};
export const dynamic='force-dynamic';
export default async function KidsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){await requireChatGPTUser('/kids');const q=await searchParams;return <KidsApp serviceReturn={typeof q.billingReturn==='string'||typeof q.portalReturn==='string'}/>;}
