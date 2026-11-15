/* eslint-disable @typescript-eslint/no-require-imports -- Render real figures and hooks with a local TypeScript loader. */
const fs=require('node:fs'), ts=require('typescript'), assert=require('node:assert/strict');
const {test}=require('node:test'), React=require('react'), {renderToStaticMarkup}=require('react-dom/server'), {JSDOM}=require('jsdom');
const compile=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);
require.extensions['.ts']=compile;require.extensions['.tsx']=compile;
const base='../app/projects/[projectId]/';
const {elasticNetPairs,elasticPairKey,betaText}=require(base+'_lib/elasticNet.ts');
const {RegulatorPathFigure}=require(base+'_components/TrajectoryFigures.tsx');
const {edgeDistributions}=require(base+'_components/network/distributions.ts');
const {linksCsv}=require(base+'_components/network/paperData.ts');
const edge={key:'a',source:'A',target:'B',score:.8,confidence:.9,bootstrapVerified:true,count:1,rank:1,sign:1,direction:1,directionConfidence:1,directionCoverage:1,supportingAlgorithms:['GENIE3']};

test('trajectory pairs preserve arrow direction, deduplicate and exclude self edges; formatting preserves zero and missing',()=>{
 assert.deepEqual(elasticNetPairs([{source:'A',target:'B'},{source:'A',target:'B'},{source:'B',target:'A'},{source:'A',target:'A'}]),[{source:'A',target:'B'},{source:'B',target:'A'}]);
 assert.notEqual(elasticPairKey('A|B','C'),elasticPairKey('A','B|C'));
 for(const [value,text] of [[0,'0.000'],[-.6,'-0.600'],[.6,'+0.600'],[null,'—'],[NaN,'—'],[.00001,'1.00e-5']])assert.equal(betaText(value),text);
});
const props={lineage:{name:'L1',pseudotime:[0,1,2],expression:{A:[0,1,2],B:[0,.3,2],C:[0,.1,2],D:[0,.2,2]}},target:'C',direct:['B','D'],upstream:['A'],focus:'B',pickedDirect:['B'],pickedUpstream:['A'],plotted:['A','B'],colorOrder:['A','B','D'],onsets:{A:.3,B:.7,C:1.2,D:.8},targets:[{gene:'C',count:2}],onDirect(){},onUpstream(){},onTarget(){}};
const values=new Map([[elasticPairKey('A','B'),{beta:-.6,reason:null}],[elasticPairKey('B','C'),{beta:0,reason:null}],[elasticPairKey('D','C'),{beta:null,reason:'Gene missing from the expression matrix.'}]]);
const coefficientFor=(source,target)=>values.get(elasticPairKey(source,target));
test('upstream and direct arrows display the matching signed beta, zero, or unavailable fit',()=>{
 const markup=renderToStaticMarkup(React.createElement(RegulatorPathFigure,{...props,coefficientFor}));
 const doc=new JSDOM(markup).window.document;
 assert.equal(doc.querySelectorAll('[data-edge-beta]').length,3);
 const label=key=>doc.querySelector(`[data-edge-beta="${key}"]`);
 assert.equal(doc.querySelectorAll('[data-beta-heading]').length,2);
 assert.equal(label('A→B').firstChild.textContent,'-0.600');assert.equal(label('B→C').firstChild.textContent,'0.000');assert.equal(label('D→C').firstChild.textContent,'—');
 // Each value stays on its regulator's row even when all arrows converge.
 assert.notEqual(label('B→C').getAttribute('y'),label('D→C').getAttribute('y'));
 assert.equal(label('B→C').getAttribute('x'),label('D→C').getAttribute('x'));
 assert.notEqual(label('B→C').getAttribute('fill'),label('D→C').getAttribute('fill'));
 assert.match(label('D→C').querySelector('title').textContent,/Gene missing/);assert.doesNotMatch(markup,/NaN|Infinity/);
 const loadingDoc=new JSDOM(renderToStaticMarkup(React.createElement(RegulatorPathFigure,{...props,coefficientFor,betaLoading:true}))).window.document;
 assert.equal(loadingDoc.querySelector('[data-edge-beta]').firstChild.textContent,'…');
 const changed=renderToStaticMarkup(React.createElement(RegulatorPathFigure,{...props,target:'B',direct:['A'],upstream:[],focus:'A',coefficientFor}));
 assert.match(changed,/data-edge-beta="A→B"/);assert.doesNotMatch(changed,/data-edge-beta="B→C"/);
});
test('network distributions, exports and line width choices contain no Elastic Net metrics',()=>{
 const distributions=edgeDistributions([edge]);assert.deepEqual(distributions.map(d=>d.name),['Evidence','Confidence']);assert.equal(distributions[0].total,1);
 assert.equal(edgeDistributions([{...edge,bootstrapVerified:false}])[1].total,0);assert.doesNotMatch(linksCsv([edge]),/elastic|beta/i);
 const {NetworkKey}=require(base+'_components/network/Legend.tsx');
 assert.doesNotMatch(renderToStaticMarkup(React.createElement(NetworkKey,{widthBy:'evidence',methodCount:2,onWidthByChange(){}})),/elastic|beta|β/i);
});
test('hook requests only trajectory arrows and never leaks a coefficient across scopes',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const originalFetch=global.fetch,calls=[];
 global.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return{ok:true,json:async()=>({coefficients:[{source:'A',target:'B',beta:0,reason:null}]})};};
 const {createRoot}=require('react-dom/client'),{useElasticNet}=require(base+'_hooks/useElasticNet.ts');let state;
 function Probe({scope}){state=useElasticNet('demo',scope,[{source:'A',target:'B'}]);return null;}
 const root=createRoot(document.getElementById('root'));
 try{
  await React.act(async()=>root.render(React.createElement(Probe,{scope:'global'})));await React.act(async()=>new Promise(resolve=>setTimeout(resolve,350)));
  assert.equal(calls.length,1);assert.deepEqual(calls[0].body,{scope_id:'global',pairs:[{source:'A',target:'B'}]});assert.equal(state.coefficientFor('A','B').beta,0);assert.equal(state.coefficientFor('B','A'),undefined);
  await React.act(async()=>root.render(React.createElement(Probe,{scope:'cluster_1'})));assert.equal(state.coefficientFor('A','B'),undefined);assert.equal(state.loading,true);
  await React.act(async()=>new Promise(resolve=>setTimeout(resolve,350)));assert.equal(calls.length,2);assert.equal(calls[1].body.scope_id,'cluster_1');assert.equal(state.coefficientFor('A','B').beta,0);
 }finally{await React.act(async()=>root.unmount());global.fetch=originalFetch;dom.window.close();}
});
