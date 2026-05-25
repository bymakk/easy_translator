/*! Easy Translator (c) 2026 bymakk (https://github.com/bymakk/easy_translator)
 * Proprietary software. Copying, forking, or commercial use is prohibited.
 * See LICENSE: https://github.com/bymakk/easy_translator/blob/main/LICENSE
 */(function(){const t=window;if(t.__etPageKbShield)return;t.__etPageKbShield=!0;function r(){const e=document.activeElement;return!e||!(e instanceof Element)?!1:e.matches("[data-translator-theme]")||e.closest("[data-translator-theme]")!==null}function a(e){return!!(e.key==="Escape"||e.shiftKey&&e.key==="Enter"&&!e.metaKey&&!e.ctrlKey&&!e.altKey)}function n(e){r()&&(a(e)||(e.stopImmediatePropagation(),e.stopPropagation()))}window.addEventListener("keydown",n,!0),window.addEventListener("keypress",n,!0)})();
