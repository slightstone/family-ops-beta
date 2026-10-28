'use client';
import {useEffect,useRef} from 'react';
export default function AccessUnavailable({draft='',left=false}:{draft?:string;left?:boolean}){
 const heading=useRef<HTMLHeadingElement>(null);useEffect(()=>{heading.current?.focus();},[]);
 return <main className="kids-shell"><section className="kids-panel"><h1 ref={heading} tabIndex={-1}>{left?'You left this organizer':'Organizer access unavailable'}</h1><p role="alert">{left?'Your organizer membership has ended. Saved family work remains with its owner.':'Sign in with the invited account or ask the owner to review your access.'}</p>{draft&&<><p>Your draft was not saved. You can copy it below.</p><label>Your unsaved draft<textarea readOnly rows={9} value={draft} onFocus={e=>e.target.select()}/></label></>}<p className="kids-hint">This does not create another board or change private Site viewer access.</p></section></main>;
}
