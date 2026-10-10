'use strict';
const $=id=>document.getElementById(id);
const wave=document.querySelector('.wave');if(wave)for(let i=0;i<40;i++){const bar=document.createElement('i');bar.style.setProperty('--h',(12+(i*17%35))+'px');wave.append(bar)}

const yearEl=$('year');if(yearEl)yearEl.textContent=new Date().getFullYear();

const menuEl=$('menu');
if(menuEl)menuEl.onclick=()=>{const open=$('nav-links').classList.toggle('open');menuEl.setAttribute('aria-expanded',String(open))};

document.querySelectorAll('#nav-links a').forEach(a=>a.onclick=()=>{const linksEl=$('nav-links');if(linksEl)linksEl.classList.remove('open');const m=$('menu');if(m)m.setAttribute('aria-expanded','false')});

