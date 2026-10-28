export function createCookingState(plan) {
  let snapshot={currentStage:0,view:'focus',timer:{status:'idle',durationSeconds:600,remainingSeconds:600}};
  const listeners=new Set(); let ticker;
  const publish=()=>listeners.forEach(listener=>listener(structuredClone(snapshot)));
  const update=change=>{snapshot={...snapshot,...change};publish();};
  const stopTicker=()=>{if(ticker){clearInterval(ticker);ticker=undefined;}};
  const startTicker=()=>{stopTicker();ticker=setInterval(()=>{if(snapshot.timer.status!=='running')return;const remaining=Math.max(0,snapshot.timer.remainingSeconds-1);snapshot={...snapshot,timer:{...snapshot.timer,remainingSeconds:remaining,status:remaining===0?'complete':'running'}};if(!remaining)stopTicker();publish();},1000);};
  return {subscribe(listener){listeners.add(listener);listener(structuredClone(snapshot));return()=>listeners.delete(listener);},get(){return structuredClone(snapshot);},next(){update({currentStage:Math.min(plan.timeline.length-1,snapshot.currentStage+1)});},previous(){update({currentStage:Math.max(0,snapshot.currentStage-1)});},goTo(index){update({currentStage:Math.max(0,Math.min(plan.timeline.length-1,index))});},toggleTimer(){if(snapshot.timer.status==='idle'||snapshot.timer.status==='complete'){snapshot={...snapshot,timer:{status:'running',durationSeconds:600,remainingSeconds:600}};startTicker();publish();return;}if(snapshot.timer.status==='running'){snapshot={...snapshot,timer:{...snapshot.timer,status:'paused'}};stopTicker();publish();return;}snapshot={...snapshot,timer:{...snapshot.timer,status:'running'}};startTicker();publish();}};
}
