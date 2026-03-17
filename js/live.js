function startLiveUpdates(store = null) {

  const storeName = store || document.body.dataset.store || "timhortons";

  async function fetchStoreStatus(name) {
    const response = await fetch(`/queue?store=${encodeURIComponent(name)}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Queue API error");
    }

    return await response.json();
  }

  function mapStatus(status) {
    if (status === "NOT BUSY") return "NOT BUSY";
    if (status === "MODERATE") return "MODERATE";
    if (status === "BUSY") return "BUSY";
    return status || "UNKNOWN";
  }

  function getWaitTime(label) {
    if (label === "NOT BUSY") return "5-6";
    if (label === "MODERATE") return "8-9";
    if (label === "BUSY") return "11-12";
    return "--";
  }

  function setColor(el, label) {
    if (!el) return;

    if (label === "BUSY") el.style.backgroundColor = "red";
    else if (label === "MODERATE") el.style.backgroundColor = "yellow";
    else if (label === "NOT BUSY") el.style.backgroundColor = "green";
    else el.style.backgroundColor = "";
  }

  async function updateSingleStorePage() {

    const data = await fetchStoreStatus(storeName);

    const people = Number(data.people ?? 0);
    const label = mapStatus(data.status);

    document.querySelectorAll(".number-of-people").forEach(el=>{
      el.textContent = people;
    });

    document.querySelectorAll(".status").forEach(el=>{
      el.textContent = label;
      setColor(el,label);
    });

    document.querySelectorAll(".est").forEach(el=>{
      el.textContent = getWaitTime(label);
    });

    const d = data.updated ? new Date(data.updated) : new Date();

    const h = String(d.getHours()).padStart(2,"0");
    const m = String(d.getMinutes()).padStart(2,"0");
    const s = String(d.getSeconds()).padStart(2,"0");

    document.querySelectorAll(".hour").forEach(el=>el.textContent=h);
    document.querySelectorAll(".mins").forEach(el=>el.textContent=m);
    document.querySelectorAll(".secs").forEach(el=>el.textContent=s);

    document.querySelectorAll(".online-status").forEach(el=>{
      el.textContent = "Live";
    });

    document.querySelectorAll(".esthr1").forEach(el=>{
      el.textContent = data.busiest_hour_start ?? "--";
    });

    document.querySelectorAll(".esthr2").forEach(el=>{
      el.textContent = data.busiest_hour_end ?? "--";
    });
  }

  async function updateStoresPage(){

    const stores = ["timhortons","starbucks","edojapan"];
    const cards = document.querySelectorAll(".layout");

    const results = await Promise.all(
      stores.map(async(name)=>{
        try{
          return {store:name,data:await fetchStoreStatus(name)};
        }
        catch{
          return {store:name,data:null};
        }
      })
    );

    const now = new Date();

    document.querySelectorAll(".refresh-hour")
      .forEach(el=>el.textContent=String(now.getHours()).padStart(2,"0"));

    document.querySelectorAll(".refresh-mins")
      .forEach(el=>el.textContent=String(now.getMinutes()).padStart(2,"0"));

    document.querySelectorAll(".refresh-seconds")
      .forEach(el=>el.textContent=String(now.getSeconds()).padStart(2,"0"));

    results.forEach((item,index)=>{

      const card = cards[index];
      if(!card) return;

      const statusEl = card.querySelector(".status");
      const hourEl = card.querySelector(".updated-hour");
      const minEl = card.querySelector(".updated-mins");

      if(!item.data){
        if(statusEl) statusEl.textContent="OFFLINE";
        return;
      }

      const label = mapStatus(item.data.status);

      if(statusEl){
        statusEl.textContent = label;
        setColor(statusEl,label);
      }

      const d = item.data.updated ? new Date(item.data.updated) : new Date();

      if(hourEl) hourEl.textContent = String(d.getHours()).padStart(2,"0");
      if(minEl) minEl.textContent = String(d.getMinutes()).padStart(2,"0");
    });
  }

  async function update(){
    try{

      if(document.querySelector(".number-of-people")){
        await updateSingleStorePage();
      }

      else if(document.querySelector(".layout")){
        await updateStoresPage();
      }

    } catch(e){

      document.querySelectorAll(".online-status").forEach(el=>{
        el.textContent="Offline";
      });

      console.log("Live update error:",e);
    }
  }

  update();
  setInterval(update,5000);
}


/* AUTO START */

document.addEventListener("DOMContentLoaded",()=>{
  startLiveUpdates();
});