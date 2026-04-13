(function(){
  var t="event";
  try{var s=localStorage.getItem("fgo_active_tab");if(s)t=s}catch(e){}
  if(t!=="event") document.documentElement.setAttribute("data-tab",t);
})();
