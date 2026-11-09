const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./diamond-hw2VK6od.js","./teact-BfK0E3zo.js","./fasterdom-B8uvNjHx.js","./core-wqAUrhUS.js","./rolldown-runtime-hePW80VL.js","./math-DcsLM4n_.js","./openModals-DAQUykAd.js","./useLastCallback-BkwZJXqt.js","./animation-DWJPnJIl.js","./WalletAppIcon-UlTFGazu.js","./deepLinkParser-B3GbWZj-.js","./colors-Dy8YboND.js","./preload-helper-CRzLMJPS.js","./buffer-FkYPdR8o.js","./base64-ebjVOhzP.js","./deepLinkParser-DSDGF-nr.css","./Transition-D8QmDugF.js","./InputText-DWwNsvRk.js","./InputText-BAeo5OO3.css","./cacheApi-76DgXNpl.js","./Transition-giLYO1y3.css","./useDebouncedCallback-K9nz2dnS.js","./DropdownMenu-dQ5hAxvU.js","./DropdownMenu-Dcls08u0.css","./WalletAppIcon-CMk9QgVE.css","./model-t1-qf2J0.js","./gpu-BUx5oMUI.js"])))=>i.map(i=>d[i]);
import{F as e,I as t,Jt as n,Tf as r,Xp as i,im as a,rm as o}from"./deepLinkParser-B3GbWZj-.js";import{cn as s,r as c,t as l}from"./fasterdom-B8uvNjHx.js";import{g as u,u as d,v as f,x as p,y as m}from"./teact-BfK0E3zo.js";import{ut as h,x as g}from"./colors-Dy8YboND.js";import{t as _}from"./preload-helper-CRzLMJPS.js";import{t as v}from"./useLastCallback-BkwZJXqt.js";import{D as y}from"./Transition-D8QmDugF.js";import{H as b,Y as x,et as S,l as C,n as ee,r as te,v as w,y as T}from"./InputText-DWwNsvRk.js";import{r as E}from"./openModals-DAQUykAd.js";import{n as ne}from"./DropdownMenu-dQ5hAxvU.js";import{t as re}from"./ListItem-B4o3Q8X1.js";import{h as D}from"./Modal-YP4i9qfr.js";import{u as O}from"./WalletAppIcon-UlTFGazu.js";var k=`D:/Dev/proxygram/apps/client/src/components/ui/TextArea.tsx`,A=d(({ref:e,id:t,className:n,value:i,label:o,error:d,success:f,disabled:h,readOnly:g,placeholder:_,autoComplete:y,inputMode:b,maxLength:S,maxLengthIndicator:C,hasLengthIndicator:te,tabIndex:w,onChange:T,onInput:E,onKeyPress:ne,onKeyDown:re,onBlur:D,onPaste:O,noReplaceNewlines:A})=>{let j=p();e&&(j=e);let M=x(),N=d||f||o,P=r(`input-group`,i&&`touched`,d?`error`:f&&`success`,h&&`disabled`,g&&`disabled`,N&&`with-label`,n),F=p(),I=v(e=>{F.current=e.value,c(()=>{e.style.height=`0`,l(()=>{let t=e.scrollHeight;return()=>{e.style.height=`${t}px`}})})});m(()=>{let e=j.current;e&&e.value!==F.current&&I(e)},[i]);let L=u(e=>{let t=e.currentTarget;if(!A){let e=t.selectionEnd;t.value=t.value.replace(/\n/g,` `),t.selectionEnd=e}I(t),T?.(e)},[A,T]);return a(`div`,{className:P,dir:M.isRtl?`rtl`:void 0,children:[a(`textarea`,{ref:j,className:`form-control`,id:t,dir:`auto`,value:i||``,tabIndex:w,placeholder:_,maxLength:S,autoComplete:y,spellCheck:!s&&void 0,inputMode:b,disabled:h,readOnly:g,onChange:L,onInput:E,onKeyPress:ne,onKeyDown:re,onBlur:D,onPaste:O,"aria-label":N},void 0,!1,{fileName:k,lineNumber:122,columnNumber:7},void 0),N&&a(`label`,{htmlFor:t,children:N},void 0,!1,{fileName:k,lineNumber:145,columnNumber:9},void 0),(C||te&&S!==void 0)&&a(`div`,{className:`max-length-indicator`,children:a(ee,{text:C||Math.max(0,S-(i||``).length).toString()},void 0,!1,{fileName:k,lineNumber:149,columnNumber:11},void 0)},void 0,!1,{fileName:k,lineNumber:148,columnNumber:9},void 0)]},void 0,!0,{fileName:k,lineNumber:121,columnNumber:5},void 0)}),j=g(`#0098EA`),M={blue:j,blueGradient:[g(`#0158AF`),g(`#67D0FF`)],purple:g(`#966FFE`),purpleGradient:[g(`#6B93FF`),g(`#E46ACE`)],gold:g(`#FFBF0A`),goldGradient:[g(`#FDEB32`),g(`#D75902`)]},N={particleCount:5,distanceLimit:1,fadeInTime:.05,minLifetime:3,maxLifetime:3,maxStartTimeDelay:0,selfDestroyTime:3,minSpawnRadius:5,maxSpawnRadius:50},P={width:350,height:230,particleCount:100,color:j,speed:18,baseSize:6,minSpawnRadius:35,maxSpawnRadius:70,distanceLimit:.7,fadeInTime:.25,fadeOutTime:1,minLifetime:4,maxLifetime:6,maxStartTimeDelay:3,edgeFadeZone:50,centerShift:[0,0],accelerationFactor:3,selfDestroyTime:0},F=.67,I=1.33,L=2.2,R=new Map;function z(e,t){let n=R.get(e);return n||(n=ie(e),R.set(e,n)),n.addSystem(t)}function ie(e){let t=e.getContext(`webgl`,{alpha:!0,antialias:!1,preserveDrawingBuffer:!1});if(!t)throw Error(`WebGL not supported`);let n=B(t,t.VERTEX_SHADER,ae),r=B(t,t.FRAGMENT_SHADER,oe);if(!n||!r)throw Error(`Failed to create shaders`);let i=se(t,n,r);if(!i)throw Error(`Failed to create shader program`);let a=window.devicePixelRatio||1,o=new Map,s={attributes:{startPosition:t.getAttribLocation(i,`a_startPosition`),velocity:t.getAttribLocation(i,`a_velocity`),startTime:t.getAttribLocation(i,`a_startTime`),lifetime:t.getAttribLocation(i,`a_lifetime`),size:t.getAttribLocation(i,`a_size`),baseOpacity:t.getAttribLocation(i,`a_baseOpacity`),color:t.getAttribLocation(i,`a_color`)},uniforms:{resolution:t.getUniformLocation(i,`u_resolution`),time:t.getUniformLocation(i,`u_time`),canvasWidth:t.getUniformLocation(i,`u_canvasWidth`),canvasHeight:t.getUniformLocation(i,`u_canvasHeight`),accelerationFactor:t.getUniformLocation(i,`u_accelerationFactor`),fadeInTime:t.getUniformLocation(i,`u_fadeInTime`),fadeOutTime:t.getUniformLocation(i,`u_fadeOutTime`),edgeFadeZone:t.getUniformLocation(i,`u_edgeFadeZone`),rotationMatrices:t.getUniformLocation(i,`u_rotationMatrices`),spawnCenter:t.getUniformLocation(i,`u_spawnCenter`)}},c,l;function u(e){let n=new ce(e.seed),{config:r}=e,i=new Float32Array(r.particleCount*2),o=new Float32Array(r.particleCount*2),s=new Float32Array(r.particleCount),c=new Float32Array(r.particleCount),l=new Float32Array(r.particleCount),u=new Float32Array(r.particleCount),d=new Float32Array(r.particleCount*3);for(let t=0;t<r.particleCount;t++){let f=n.next()*Math.PI*2,p=n.nextBetween(r.minSpawnRadius,r.maxSpawnRadius),m=Math.cos(f),h=Math.sin(f),g=e.centerX+m*p,_=e.centerY+h*p;i[t*2]=g*a,i[t*2+1]=_*a,c[t]=n.nextBetween(r.minLifetime,r.maxLifetime),s[t]=n.next()*r.maxStartTimeDelay;let v=n.nextBetween(e.avgDistance*r.distanceLimit*.5,e.avgDistance*r.distanceLimit)/c[t]*a;o[t*2]=m*v,o[t*2+1]=h*v;let y=n.next();y<.3?l[t]=r.baseSize*F*a:y<.7?l[t]=r.baseSize*I*a:l[t]=r.baseSize*L*a,u[t]=n.nextBetween(.3,.8);let[b,x,S]=ue(r.color,n).coords;d[t*3]=b||0,d[t*3+1]=x||0,d[t*3+2]=S||0}t.bindBuffer(t.ARRAY_BUFFER,e.buffers.startPosition),t.bufferData(t.ARRAY_BUFFER,i,t.STATIC_DRAW),t.bindBuffer(t.ARRAY_BUFFER,e.buffers.velocity),t.bufferData(t.ARRAY_BUFFER,o,t.STATIC_DRAW),t.bindBuffer(t.ARRAY_BUFFER,e.buffers.startTime),t.bufferData(t.ARRAY_BUFFER,s,t.STATIC_DRAW),t.bindBuffer(t.ARRAY_BUFFER,e.buffers.lifetime),t.bufferData(t.ARRAY_BUFFER,c,t.STATIC_DRAW),t.bindBuffer(t.ARRAY_BUFFER,e.buffers.size),t.bufferData(t.ARRAY_BUFFER,l,t.STATIC_DRAW),t.bindBuffer(t.ARRAY_BUFFER,e.buffers.baseOpacity),t.bufferData(t.ARRAY_BUFFER,u,t.STATIC_DRAW),t.bindBuffer(t.ARRAY_BUFFER,e.buffers.color),t.bufferData(t.ARRAY_BUFFER,d,t.STATIC_DRAW)}function d(){let n=0,r=0;o.forEach(e=>{n=Math.max(n,e.config.width),r=Math.max(r,e.config.height)}),o.size===0&&(n=P.width,r=P.height),(e.width!==n*a||e.height!==r*a)&&(e.width=n*a,e.height=r*a,e.style.width=n+`px`,e.style.height=r+`px`),t.viewport(0,0,e.width,e.height)}function f(){t.useProgram(i),t.uniform2f(s.uniforms.resolution,e.width,e.height),t.uniformMatrix2fv(s.uniforms.rotationMatrices,!1,le()),t.enable(t.BLEND),t.blendFunc(t.ONE,t.ONE_MINUS_SRC_ALPHA),t.clearColor(0,0,0,0)}function p(e){c&&=(t.clear(t.COLOR_BUFFER_BIT),o.forEach(n=>{let r=(e-n.startTime)/1e3;t.uniform1f(s.uniforms.time,r),t.uniform1f(s.uniforms.canvasWidth,n.config.width*a),t.uniform1f(s.uniforms.canvasHeight,n.config.height*a),t.uniform1f(s.uniforms.accelerationFactor,n.config.accelerationFactor),t.uniform1f(s.uniforms.fadeInTime,n.config.fadeInTime),t.uniform1f(s.uniforms.fadeOutTime,n.config.fadeOutTime),t.uniform1f(s.uniforms.edgeFadeZone,n.config.edgeFadeZone*a),t.uniform2f(s.uniforms.spawnCenter,n.centerX*a,n.centerY*a),t.bindBuffer(t.ARRAY_BUFFER,n.buffers.startPosition),t.enableVertexAttribArray(s.attributes.startPosition),t.vertexAttribPointer(s.attributes.startPosition,2,t.FLOAT,!1,0,0),t.bindBuffer(t.ARRAY_BUFFER,n.buffers.velocity),t.enableVertexAttribArray(s.attributes.velocity),t.vertexAttribPointer(s.attributes.velocity,2,t.FLOAT,!1,0,0),t.bindBuffer(t.ARRAY_BUFFER,n.buffers.startTime),t.enableVertexAttribArray(s.attributes.startTime),t.vertexAttribPointer(s.attributes.startTime,1,t.FLOAT,!1,0,0),t.bindBuffer(t.ARRAY_BUFFER,n.buffers.lifetime),t.enableVertexAttribArray(s.attributes.lifetime),t.vertexAttribPointer(s.attributes.lifetime,1,t.FLOAT,!1,0,0),t.bindBuffer(t.ARRAY_BUFFER,n.buffers.size),t.enableVertexAttribArray(s.attributes.size),t.vertexAttribPointer(s.attributes.size,1,t.FLOAT,!1,0,0),t.bindBuffer(t.ARRAY_BUFFER,n.buffers.baseOpacity),t.enableVertexAttribArray(s.attributes.baseOpacity),t.vertexAttribPointer(s.attributes.baseOpacity,1,t.FLOAT,!1,0,0),t.bindBuffer(t.ARRAY_BUFFER,n.buffers.color),t.enableVertexAttribArray(s.attributes.color),t.vertexAttribPointer(s.attributes.color,3,t.FLOAT,!1,0,0),t.drawArrays(t.POINTS,0,n.config.particleCount)}),requestAnimationFrame(p))}function m(e){let n=h(),r={...P,...e},i={id:n,config:r,buffers:{startPosition:t.createBuffer(),velocity:t.createBuffer(),startTime:t.createBuffer(),lifetime:t.createBuffer(),size:t.createBuffer(),baseOpacity:t.createBuffer(),color:t.createBuffer()},startTime:performance.now(),seed:Math.floor(Math.random()*1e6),centerX:r.width/2+r.centerShift[0],centerY:r.height/2+r.centerShift[1],avgDistance:(r.width/2+r.height/2)/2};return o.set(n,i),u(i),d(),r.selfDestroyTime&&(i.selfDestroyTimeout=window.setTimeout(()=>{g(n)},r.selfDestroyTime*1e3)),o.size===1&&(f(),l=E.subscribe(()=>{let e=!E();e&&!c?c=requestAnimationFrame(p):!e&&c&&(cancelAnimationFrame(c),c=void 0)}),c=requestAnimationFrame(p)),()=>g(n)}function g(e){let n=o.get(e);n&&(n.selfDestroyTimeout&&clearTimeout(n.selfDestroyTimeout),Object.values(n.buffers).forEach(e=>{e&&t.deleteBuffer(e)}),o.delete(e),o.size===0&&_())}function _(){c!==void 0&&(cancelAnimationFrame(c),c=void 0),l?.(),o.clear(),t.deleteProgram(i),t.deleteShader(n),t.deleteShader(r),R.delete(e)}return{addSystem:m}}var ae=`
    attribute vec2 a_startPosition;
    attribute vec2 a_velocity;
    attribute float a_startTime;
    attribute float a_lifetime;
    attribute float a_size;
    attribute float a_baseOpacity;
    attribute vec3 a_color;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_canvasWidth;
    uniform float u_canvasHeight;
    uniform float u_accelerationFactor;
    uniform float u_fadeInTime;
    uniform float u_fadeOutTime;
    uniform float u_edgeFadeZone;
    uniform mat2 u_rotationMatrices[18];
    uniform vec2 u_spawnCenter;

    varying float v_opacity;
    varying vec3 v_color;

    void main() {
        float totalAge = u_time - a_startTime;
        float age = mod(totalAge, a_lifetime);

        // For the initial animation, fade in all particles
        float globalFadeIn = min(u_time / u_fadeInTime, 1.0);

        float lifeRatio = age / a_lifetime;

        // Calculate rotation based on completed lifecycles
        float lifecycleCount = floor(totalAge / a_lifetime);
        int rotationIndex = int(mod(lifecycleCount, 18.0));

        // Get rotation matrix
        mat2 rotationMatrix = u_rotationMatrices[rotationIndex];

        // Rotate start position around spawn center
        vec2 startOffset = a_startPosition - u_spawnCenter;
        vec2 rotatedStartOffset = rotationMatrix * startOffset;
        vec2 rotatedStartPosition = u_spawnCenter + rotatedStartOffset;

        // Apply rotation matrix to velocity
        vec2 rotatedVelocity = rotationMatrix * a_velocity;

        // Apply shoot-out effect: fast initial speed that slows down
        float speedMultiplier = 1.0 + u_accelerationFactor * exp(-3.0 * lifeRatio);

        vec2 position = rotatedStartPosition + rotatedVelocity * age * speedMultiplier;

        float opacity = 1.0;
        if (lifeRatio < u_fadeInTime / a_lifetime) {
            opacity = (lifeRatio * a_lifetime) / u_fadeInTime;
        } else if (lifeRatio > 1.0 - u_fadeOutTime / a_lifetime) {
            opacity = (1.0 - lifeRatio) * a_lifetime / u_fadeOutTime;
        }
        opacity *= a_baseOpacity * globalFadeIn;

        float distToLeft = position.x;
        float distToRight = u_canvasWidth - position.x;
        float distToTop = position.y;
        float distToBottom = u_canvasHeight - position.y;
        float distToEdge = min(min(distToLeft, distToRight), min(distToTop, distToBottom));

        if (distToEdge < u_edgeFadeZone) {
            opacity *= distToEdge / u_edgeFadeZone;
        }

        vec2 clipSpace = ((position / u_resolution) * 2.0 - 1.0) * vec2(1, -1);
        gl_Position = vec4(clipSpace, 0, 1);
        gl_PointSize = a_size;
        v_opacity = opacity;
        v_color = a_color;
    }
`,oe=`
    precision mediump float;

    varying float v_opacity;
    varying vec3 v_color;

    void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);

        // Create a four-pointed star
        float absX = abs(coord.x);
        float absY = abs(coord.y);

        // Star parameters
        float innerSize = 0.12;    // Size of center square
        float armLength = 0.45;    // Length of star arms
        float armWidth = 0.08;     // Half-width of star arms at base

        float dist = 1.0; // Default to outside

        // Center square
        if (absX <= innerSize && absY <= innerSize) {
            dist = max(absX, absY) - innerSize;
        }
        // Horizontal arms (left and right points)
        else if (absY <= armWidth && absX <= armLength) {
            // Taper the arms - they get narrower toward the tips
            float normalizedX = (absX - innerSize) / (armLength - innerSize);
            float taperFactor = 1.0 - normalizedX * 0.8; // Taper to 20% of original width
            float currentArmWidth = armWidth * taperFactor;
            dist = absY - currentArmWidth;
        }
        // Vertical arms (top and bottom points)
        else if (absX <= armWidth && absY <= armLength) {
            // Taper the arms - they get narrower toward the tips
            float normalizedY = (absY - innerSize) / (armLength - innerSize);
            float taperFactor = 1.0 - normalizedY * 0.8; // Taper to 20% of original width
            float currentArmWidth = armWidth * taperFactor;
            dist = absX - currentArmWidth;
        }

        // Use smoothstep for anti-aliasing to reduce subpixel artifacts
        float alpha = 1.0 - smoothstep(-0.01, 0.01, dist);

        if (alpha <= 0.0) {
            discard;
        }

        gl_FragColor = vec4(v_color * v_opacity * alpha, v_opacity * alpha);
    }
`;function B(e,t,n){let r=e.createShader(t);if(r){if(e.shaderSource(r,n),e.compileShader(r),!e.getShaderParameter(r,e.COMPILE_STATUS))e.deleteShader(r);else return r}}function se(e,t,n){let r=e.createProgram();if(r){if(e.attachShader(r,t),e.attachShader(r,n),e.linkProgram(r),!e.getProgramParameter(r,e.LINK_STATUS))e.deleteProgram(r);else return r}}var ce=class{seed;constructor(e){this.seed=e}next(){return this.seed=(this.seed*9301+49297)%233280,this.seed/233280}nextBetween(e,t){return e+(t-e)*this.next()}},V;function le(){if(!V){V=new Float32Array(72);for(let e=0;e<18;e++){let t=220*Math.PI/180*e,n=Math.cos(t),r=Math.sin(t);V[e*4]=n,V[e*4+1]=r,V[e*4+2]=-r,V[e*4+3]=n}}return V}function ue(e,t){if(`coords`in e)return e;let[n,r]=e,[i,a,o]=n.coords,[s,c,l]=r.coords;return g({space:`srgb`,coords:[t.nextBetween(i||0,s||0),t.nextBetween(a||0,c||0),t.nextBetween(o||0,l||0)]})}var de={sparkles:`JxY8hVTW`},fe=`D:/Dev/proxygram/apps/client/src/components/common/InteractiveSparkles.tsx`,pe={centerShift:[0,-36]},me=15,H=d(({color:e=`purple`,centerShift:t=pe.centerShift,isDisabled:n,className:i,onRequestAnimation:o})=>{let s=p(),c=p(0);return m(()=>{if(!n)return z(s.current,{color:M[`${e}Gradient`],centerShift:t})},[t,e,n]),f(()=>{o&&o(()=>{if(n)return;let r=Date.now();r-c.current<me||(c.current=r,z(s.current,{color:M[`${e}Gradient`],centerShift:t,...N}))})},[t,e,n,o]),a(`canvas`,{ref:s,className:r(de.sparkles,i)},void 0,!1,{fileName:fe,lineNumber:66,columnNumber:5},void 0)}),U={root:`woZWPU7X`,preview:`-moeQylm`,previewHidden:`mGT1XdIL`,canvas:`fDA6MU2y`,ready:`UbJiz6U-`},W=`D:/Dev/proxygram/apps/client/src/components/modals/wallet/WalletDiamond.tsx`,G=d(({size:e})=>{let i=p(),o=t(n),[s,c]=b(),[l,u]=b(),d=o&&!l;if(f(()=>{if(!d)return;let e=i.current,t,n=!1;return _(async()=>{let{setupDiamond:e}=await import(`./diamond-hw2VK6od.js`);return{setupDiamond:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26]),import.meta.url).then(({setupDiamond:r})=>{n||(t=r(e,c,u))},u),()=>{n=!0,t?.()}},[d]),!d)return a(ne,{tgsUrl:T.BlueDiamond,previewUrl:w.BlueDiamond,size:e,play:o,nonInteractive:!o},void 0,!1,{fileName:W,lineNumber:49,columnNumber:7},void 0);let m=Math.round(e*(window.devicePixelRatio||1));return a(`div`,{className:U.root,style:`width: ${e}px; height: ${e}px`,children:[a(`img`,{src:w.BlueDiamond3d,alt:``,draggable:!1,className:r(U.preview,s&&U.previewHidden)},void 0,!1,{fileName:W,lineNumber:64,columnNumber:7},void 0),a(`canvas`,{ref:i,className:r(U.canvas,s&&U.ready),width:m,height:m,style:`width: ${e}px; height: ${e}px`},void 0,!1,{fileName:W,lineNumber:70,columnNumber:7},void 0)]},void 0,!0,{fileName:W,lineNumber:63,columnNumber:5},void 0)}),K={root:`QcfrGLdX`,star:`nDPg-zs5`,star_purple:`-f2S1Tk6`,starPurple:`-f2S1Tk6`},he=`D:/Dev/proxygram/apps/client/src/components/modals/common/SwayingStar.tsx`,ge=50;function _e({className:e,color:t,centerShift:n,onMouseMove:i}){let o=x(),s=p(),l=v(e=>{let t=e.currentTarget.getBoundingClientRect(),r=t.left+t.width/2+n[0],a=t.top+t.height/2+n[1],o=e.clientX-r,l=e.clientY-a,u=Math.max(-1,Math.min(1,o/ge)),d=Math.max(-1,Math.min(1,l/ge)),f=u*40,p=-d*40;c(()=>{s.current.style.transform=`scale(1.1) rotateX(${p}deg) rotateY(${f}deg)`}),i()}),u=v(()=>{c(()=>{s.current.style.transform=``})});return a(`div`,{className:r(K.root,e),onMouseMove:l,onMouseLeave:u,children:a(`div`,{ref:s,className:r(K.star,K[`star_${t}`]),role:`img`,"aria-label":o(`TelegramStars`)},void 0,!1,{fileName:he,lineNumber:60,columnNumber:7},this)},void 0,!1,{fileName:he,lineNumber:55,columnNumber:5},this)}var ve=d(_e),q={root:`cK6KQXnQ`,"ai-egg":`ZP86O9Hy`,aiEgg:`ZP86O9Hy`,title:`xRm-Im3m`,description:`IQdQ9MU9`,particles:`_8ooQ3s8b`,stickerWrapper:`hHs2sTV-`,diamond3d:`tPAJ2-tU`,diamond3D:`tPAJ2-tU`,cocoon:`Rlhm9gZk`},ye=new URL(`cocoon-DzgJltGQ.webp`,import.meta.url).href,J=`D:/Dev/proxygram/apps/client/src/components/modals/common/ParticlesHeader.tsx`,Y=8*S,be=130,xe={centerShift:[0,-36]};function Se({model:e,sticker:t,color:n,title:i,description:o,isDisabled:s,className:c,modelClassName:l,titleClassName:u}){let d=p(),f=p(),m=v(()=>{f.current?.()}),h=v(e=>{f.current=e});return a(`div`,{className:r(q.root,q[e],c),children:[a(H,{color:n,centerShift:xe.centerShift,isDisabled:s,className:q.particles,onRequestAnimation:h},void 0,!1,{fileName:J,lineNumber:63,columnNumber:7},this),e===`swaying-star`?a(ve,{className:l,color:n,centerShift:xe.centerShift,onMouseMove:m},void 0,!1,{fileName:J,lineNumber:72,columnNumber:9},this):e===`ai-egg`?a(`img`,{src:ye,alt:``,role:`presentation`,"aria-hidden":`true`,className:r(q.cocoon,l),draggable:!1,onMouseMove:m},void 0,!1,{fileName:J,lineNumber:79,columnNumber:9},this):e===`diamond-3d`?a(`div`,{className:r(q.diamond3d,l),onMouseMove:m,children:a(G,{size:be},void 0,!1,{fileName:J,lineNumber:90,columnNumber:11},this)},void 0,!1,{fileName:J,lineNumber:89,columnNumber:9},this):e===`sticker`&&t&&a(`div`,{ref:d,className:r(q.stickerWrapper,l),style:`width: ${Y}px; height: ${Y}px`,onMouseMove:m,children:a(y,{containerRef:d,sticker:t,size:Y,shouldPreloadPreview:!0,shouldLoop:!0},void 0,!1,{fileName:J,lineNumber:99,columnNumber:11},this)},void 0,!1,{fileName:J,lineNumber:93,columnNumber:9},this),a(`h2`,{className:r(q.title,u),children:i},void 0,!1,{fileName:J,lineNumber:109,columnNumber:7},this),a(`div`,{className:q.description,children:o},void 0,!1,{fileName:J,lineNumber:113,columnNumber:7},this)]},void 0,!0,{fileName:J,lineNumber:62,columnNumber:5},this)}var Ce=d(Se),X={table:`RMEi5Sgb`,cell:`AEl8NMjg`,title:`IypKoG1m`,value:`ZO-KCUSl`,fullWidth:`_1WIqSuNB`,chatItem:`J6it2-iy`},Z=`D:/Dev/proxygram/apps/client/src/components/modals/common/TableInfo.tsx`,we=d(({tableData:e,className:t,onChatClick:n})=>{let{openChat:s}=i(),c=v(e=>{n?n(e):s({id:e})});if(e?.length)return a(`div`,{className:r(X.table,t),children:e.map(([e,t])=>a(o,{children:[!!e&&a(`div`,{className:r(X.cell,X.title),children:e},void 0,!1,{fileName:Z,lineNumber:45,columnNumber:30},void 0),a(`div`,{className:r(X.cell,X.value,!e&&X.fullWidth),children:typeof t==`object`&&`chatId`in t?a(D,{peerId:t.chatId,className:X.chatItem,forceShowSelf:!0,withEmojiStatus:t.withEmojiStatus,clickArg:t.chatId,onClick:c},void 0,!1,{fileName:Z,lineNumber:48,columnNumber:15},void 0):t},void 0,!1,{fileName:Z,lineNumber:46,columnNumber:11},void 0)]},void 0,!0,{fileName:Z,lineNumber:44,columnNumber:9},void 0))},void 0,!1,{fileName:Z,lineNumber:42,columnNumber:5},void 0)}),Q={root:`FEEwg5rl`,secondary:`_51eeI1vd`,topIcon:`_0fVPMdEi`,premiumGradient:`oEaPoig5`,content:`_7xJ2IMc7`,listItems:`_4Smlf3-h`,listItemTitle:`lPVHA-w3`,separator:`V6iMhrLh`},$=`D:/Dev/proxygram/apps/client/src/components/modals/common/TableAboutModal.tsx`,Te=d(({className:t,isOpen:n,listItemData:i,headerIconName:o,headerIconPremiumGradient:s,header:c,footer:l,buttonText:u,hasBackdrop:d,absoluteCloseButtonColor:f,withSeparator:p,isNativeDialog:m,contentClassName:h,onClose:g,onButtonClick:_})=>a(te,{isOpen:n,className:r(Q.root,t),contentClassName:r(Q.content,h),hasAbsoluteCloseButton:!0,isNativeDialog:m,absoluteCloseButtonColor:f||(d?`translucent-white`:void 0),onClose:g,children:[o&&a(`div`,{className:r(Q.topIcon,s&&Q.premiumGradient),children:a(e,{name:o},void 0,!1,{fileName:$,lineNumber:65,columnNumber:11},void 0)},void 0,!1,{fileName:$,lineNumber:64,columnNumber:9},void 0),c,a(`div`,{className:Q.listItems,children:i?.map(([e,t,n])=>a(re,{isStatic:!0,multiline:!0,icon:e,className:Q.listItem,children:[a(`span`,{className:r(`title`,Q.listItemTitle),children:t},void 0,!1,{fileName:$,lineNumber:78,columnNumber:15},void 0),a(`span`,{className:`subtitle`,children:n},void 0,!1,{fileName:$,lineNumber:79,columnNumber:15},void 0)]},void 0,!0,{fileName:$,lineNumber:72,columnNumber:13},void 0))},void 0,!1,{fileName:$,lineNumber:69,columnNumber:7},void 0),p&&a(O,{className:Q.separator},void 0,!1,{fileName:$,lineNumber:84,columnNumber:25},void 0),l,!!u&&a(C,{onClick:_||g,children:u},void 0,!1,{fileName:$,lineNumber:87,columnNumber:9},void 0)]},void 0,!0,{fileName:$,lineNumber:54,columnNumber:5},void 0));export{H as a,G as i,we as n,A as o,Ce as r,Te as t};
//# sourceMappingURL=TableAboutModal-DCkX11Ax.js.map