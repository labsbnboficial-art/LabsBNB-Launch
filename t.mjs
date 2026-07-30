import {createPublicClient,http} from 'viem';
import {bscTestnet} from 'viem/chains';
import F from '/dev-server/src/lib/web3/abis/LabsBNBFactory.json' with {type:'json'};
import C from '/dev-server/src/lib/web3/abis/BondingCurve.json' with {type:'json'};
import T from '/dev-server/src/lib/web3/abis/LabsBNBToken.json' with {type:'json'};
const c=createPublicClient({chain:bscTestnet,transport:http('https://bsc-prebsc-dataseed.bnbchain.org')});
const factory='0x0738dA5824d03fF3E8BDDFd33cdb3728b6d8abD9';
const n=await c.readContract({address:factory,abi:F,functionName:'allTokensLength'});
console.log('total',n);
for(let i=0;i<Number(n);i++){
 const a=await c.readContract({address:factory,abi:F,functionName:'allTokens',args:[BigInt(i)]});
 const curve=await c.readContract({address:factory,abi:F,functionName:'curveOf',args:[a]});
 const name=await c.readContract({address:a,abi:T,functionName:'name'});
 console.log(i,a,curve,name);
 for (const fn of ['currentPrice','marketCap','progress','volume24h','priceChange','holders','realLiquidity','MIGRATION_THRESHOLD','remainingTokens']) {
   try{console.log('  ',fn,await c.readContract({address:curve,abi:C,functionName:fn}))}catch(e){console.log('  ',fn,'ERR',e.shortMessage||e.message)}
 }
}
