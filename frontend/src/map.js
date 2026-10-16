import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { PUNJAB_BOUNDS, PUNJAB_POLYGON } from "./config.js";

// Step 1 map: pick one spot in Punjab, then lock it.
export class SiteMap {
  constructor(el, onPick) {
    this.onPick = onPick;
    this.locked = false;
    this.map = L.map(el, {
      center: [31.4, 73.2],
      zoom: 7,
      minZoom: 6,
      maxBounds: L.latLngBounds(PUNJAB_BOUNDS).pad(0.25),
      zoomControl: true,
    });

    const sat = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Imagery © Esri" }
    );
    const street = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    });
    sat.addTo(this.map);
    L.control.layers({ Satellite: sat, Streets: street }, {}, { position: "topleft" }).addTo(this.map);

    L.polygon(PUNJAB_POLYGON, {
      color: "#f0a92e", weight: 2, dashArray: "6 6", fill: false, interactive: false,
    }).addTo(this.map);

    this.map.on("click", (e) => {
      if (this.locked) return;
      this.onPick(e.latlng.lat, e.latlng.lng);
    });
  }

  setMarker(lat, lon) {
    if (this.marker) this.marker.remove();
    this.marker = L.marker([lat, lon], {
      icon: L.divIcon({ className: "", html: '<div class="pin"></div>', iconSize: [26, 26], iconAnchor: [13, 26] }),
      interactive: false,
    }).addTo(this.map);
  }

  clearMarker() {
    if (this.marker) this.marker.remove();
    this.marker = null;
  }

  flyTo(lat, lon, zoom = 14) {
    this.map.flyTo([lat, lon], zoom, { duration: 1.2 });
  }

  lock() {
    this.locked = true;
    ["dragging", "touchZoom", "doubleClickZoom", "scrollWheelZoom", "boxZoom", "keyboard"].forEach(
      (h) => this.map[h]?.disable()
    );
  }
}
