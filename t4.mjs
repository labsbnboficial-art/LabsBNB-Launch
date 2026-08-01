const url="https://bsc-prebsc-dataseed.bnbchain.org";
async function rpc(m,p){const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:m,params:p})});return (await r.json());}
const head=BigInt((await rpc("eth_blockNumber",[])).result);
const curves=["0x5db11cc0d4f2fde666980d0bf9aee29af4933522","0xc58b22da49bec67b2f7088956e147130682e207b","0x671a1f9292fe81fa72b5dd18b2c76e365cd5c083","0x9c0b8a70f600201997d6f245cc96c46c2fec0ed7"];
for(const c of curves){let total=0,first=null;
for(let i=0;i<70;i++){const to=head-BigInt(i)*9000n,from=to-8999n;
const r=await rpc("eth_getLogs",[{address:c,fromBlock:"0x"+from.toString(16),toBlock:"0x"+to.toString(16)}]);
if(r.error){console.log(c,"ERR",r.error.message);break;}
if(r.result.length){total+=r.result.length; if(first===null)first=i;}}
console.log(c,"logs",total,"firstChunkBack",first);}
