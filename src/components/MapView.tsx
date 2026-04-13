"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { CalendarEvent, formatTime, getEventsForDate } from "@/lib/events";

interface MapViewProps {
  events: CalendarEvent[];
  theme?: string;
}

const MAX_WALKABLE_KM = 4.83; // 3 miles

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const EVENT_COLORS: Record<string, string> = {
  green: "#5a8a4a",
  blue: "#4a6a8a",
  orange: "#8a7a4a",
  red: "#8a4a4a",
  purple: "#6a4a8a",
  gray: "#6a6a6a",
};

export default function MapView({ events, theme }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [routeDuration, setRouteDuration] = useState<number | null>(null);
  const [isWalkable, setIsWalkable] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split("T")[0];
  });
  const [weekOffsetState, setWeekOffsetState] = useState(0);

  // Get dates for the current week + offset
  const weekDates = (() => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - dayOfWeek + i + weekOffsetState * 7);
      dates.push(d.toISOString().split("T")[0]);
    }
    return dates;
  })();

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;

    mapboxgl.accessToken = token;

    const mapStyle = theme === "light" ? "mapbox://styles/mapbox/light-v11" : "mapbox://styles/mapbox/dark-v11";
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: mapStyle,
      center: [-84.3963, 33.7756], // GT campus center
      zoom: 15,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    mapRef.current = map;

    // Show user location dot without auto-panning
    map.on("load", () => {
      navigator.geolocation?.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        const el = document.createElement("div");
        el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#4a90e2;border:2.5px solid white;box-shadow:0 0 0 3px rgba(74,144,226,0.25)";
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([longitude, latitude])
          .addTo(map);
        userMarkerRef.current = marker;
      }, () => { /* permission denied */ }, { enableHighAccuracy: false, timeout: 5000 });
    });

    return () => {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update map style when theme changes
  useEffect(() => {
    if (!mapRef.current) return;
    const newStyle = theme === "light" ? "mapbox://styles/mapbox/light-v11" : "mapbox://styles/mapbox/dark-v11";
    mapRef.current.setStyle(newStyle);
  }, [theme]);

  // Update markers when date/events change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing markers and routes FIRST (before any async work)
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (map.getLayer("route")) map.removeLayer("route");
    if (map.getSource("route")) map.removeSource("route");
    setRouteDuration(null);
    setIsWalkable(false);

    const dayEvents = getEventsForDate(events, selectedDate).filter((e) => e.location);

    dayEvents.forEach((event) => {
      if (!event.location) return;

      const color = EVENT_COLORS[event.color] || EVENT_COLORS.green;

      const el = document.createElement("div");
      el.style.width = "32px";
      el.style.height = "32px";
      el.style.borderRadius = "50%";
      el.style.backgroundColor = color;
      el.style.border = "3px solid white";
      el.style.boxShadow = "0 2px 8px rgba(0,0,0,0.4)";
      el.style.cursor = "pointer";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";

      const icon = document.createElement("div");
      icon.style.width = "14px";
      icon.style.height = "14px";
      icon.style.borderRadius = "50%";
      icon.style.backgroundColor = "white";
      icon.style.opacity = "0.8";
      el.appendChild(icon);

      const popup = new mapboxgl.Popup({ offset: 25, closeButton: false, className: "dark-popup" })
        .setHTML(`
          <div style="padding: 6px 4px; background: var(--card-bg, #242424); border-radius: 10px;">
            <div style="font-weight: 600; font-size: 13px; margin-bottom: 3px; color: var(--text-primary, #e8e8e8);">${event.title}</div>
            <div style="font-size: 11px; color: var(--text-secondary, #999);">${formatTime(event.startTime)} – ${formatTime(event.endTime)}</div>
            <div style="font-size: 11px; color: var(--text-muted, #666); margin-top: 2px;">${event.location.name}</div>
          </div>
        `);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([event.location.lng, event.location.lat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    });

    const checkWalkable = () => {
      if (dayEvents.length < 2) return false;
      for (let i = 0; i < dayEvents.length - 1; i++) {
        const a = dayEvents[i].location!;
        const b = dayEvents[i + 1].location!;
        if (haversineKm(a.lat, a.lng, b.lat, b.lng) > MAX_WALKABLE_KM) return false;
      }
      return true;
    };

    const drawRoute = async () => {
      if (map.getLayer("route")) map.removeLayer("route");
      if (map.getSource("route")) map.removeSource("route");

      const walkable = checkWalkable();
      setIsWalkable(walkable);

      if (dayEvents.length >= 2 && walkable) {
        const coords = dayEvents.map((e) => `${e.location!.lng},${e.location!.lat}`).join(";");
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        try {
          const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/walking/${coords}?geometries=geojson&overview=full&access_token=${token}`);
          const data = await res.json();
          if (data.routes && data.routes[0]) {
            setRouteDuration(Math.round(data.routes[0].duration / 60));
            map.addSource("route", {
              type: "geojson",
              data: { type: "Feature", properties: {}, geometry: data.routes[0].geometry },
            });
            map.addLayer({
              id: "route",
              type: "line",
              source: "route",
              layout: { "line-join": "round", "line-cap": "round" },
              paint: { "line-color": "#5a8a4a", "line-width": 4, "line-opacity": 0.7, "line-dasharray": [2, 1] },
            });
          }
        } catch { /* Route API failed */ }
      } else {
        setRouteDuration(null);
      }
    };

    if (dayEvents.length > 1) {
      const bounds = new mapboxgl.LngLatBounds();
      dayEvents.forEach((e) => {
        if (e.location) bounds.extend([e.location.lng, e.location.lat]);
      });
      map.fitBounds(bounds, { padding: { top: 80, bottom: 80, left: 300, right: 80 }, maxZoom: 16 });
      map.once("idle", drawRoute);
    } else if (dayEvents.length === 1 && dayEvents[0].location) {
      map.flyTo({ center: [dayEvents[0].location.lng, dayEvents[0].location.lat], zoom: 16 });
      setRouteDuration(null);
      setIsWalkable(false);
    } else {
      if (map.getLayer("route")) map.removeLayer("route");
      if (map.getSource("route")) map.removeSource("route");
      setRouteDuration(null);
      setIsWalkable(false);
    }
  }, [events, selectedDate]);

  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <div className="w-full h-full flex flex-col">
      {/* Date selector with week nav */}
      <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 shrink-0 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        <button
          onClick={() => setWeekOffsetState(weekOffsetState - 1)}
          className="p-2 rounded-lg transition-colors"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        {weekDates.map((date) => {
          const d = new Date(date + "T12:00:00");
          const isSelected = date === selectedDate;
          const isToday = date === todayStr;
          const dayEvents = getEventsForDate(events, date).filter((e) => e.location);
          return (
            <button
              key={date}
              onClick={() => setSelectedDate(date)}
              className="flex flex-col items-center px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl transition-all min-w-[40px] sm:min-w-[52px]"
              style={{
                background: isSelected ? "var(--accent)" : "transparent",
                border: isToday && !isSelected ? "1px solid var(--accent)" : "1px solid transparent",
              }}
            >
              <span className="text-[10px] uppercase tracking-wide" style={{ color: isSelected ? "white" : "var(--text-muted)" }}>
                {d.toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              <span className="text-sm font-semibold" style={{ color: isSelected ? "white" : "var(--text-primary)" }}>
                {d.getDate()}
              </span>
              {dayEvents.length > 0 && (
                <div className="flex gap-0.5 mt-0.5">
                  {dayEvents.slice(0, 3).map((e, i) => (
                    <div key={i} className="w-1 h-1 rounded-full" style={{ background: isSelected ? "white" : EVENT_COLORS[e.color] }} />
                  ))}
                </div>
              )}
            </button>
          );
        })}
        <button
          onClick={() => setWeekOffsetState(weekOffsetState + 1)}
          className="p-2 rounded-lg transition-colors"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
        </button>
        {weekOffsetState !== 0 && (
          <button
            onClick={() => { setWeekOffsetState(0); setSelectedDate(todayStr); }}
            className="px-2.5 py-1 rounded-lg text-[10px] font-medium"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Today
          </button>
        )}
      </div>

      {/* Map + itinerary sidebar */}
      <div className="flex-1 mx-2 sm:mx-4 mb-2 sm:mb-4 flex flex-col sm:flex-row gap-0 rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border-color)" }}>
        {/* Itinerary: collapses on mobile (short scroll), full sidebar on desktop */}
        <div className="w-full sm:w-72 shrink-0 overflow-y-auto max-h-[25vh] sm:max-h-none border-b sm:border-b-0 sm:border-r" style={{ background: "var(--bg-secondary)", borderColor: "var(--border-subtle)" }}>
          <div className="p-4">
            <p className="text-xs font-medium mb-1" style={{ color: "var(--text-primary)" }}>
              {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            </p>
            <p className="text-[10px] uppercase tracking-wider mb-4" style={{ color: "var(--text-muted)" }}>
              {(() => {
                const locEvents = getEventsForDate(events, selectedDate).filter((e) => e.location);
                return locEvents.length > 0 ? `${locEvents.length} stop${locEvents.length !== 1 ? "s" : ""}` : "No locations";
              })()}
            </p>

            {/* Itinerary timeline */}
            <div className="space-y-0">
              {getEventsForDate(events, selectedDate)
                .filter((e) => e.location)
                .map((event, i, arr) => (
                  <div key={event.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-3 h-3 rounded-full flex-shrink-0 border-2" style={{ background: EVENT_COLORS[event.color], borderColor: "var(--bg-secondary)" }} />
                      {i < arr.length - 1 && (
                        <div className="w-px flex-1 my-1" style={{ background: "var(--accent)", opacity: 0.4 }} />
                      )}
                    </div>
                    <div className="pb-4 min-w-0 flex-1">
                      <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{event.title}</p>
                      <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {formatTime(event.startTime)} – {formatTime(event.endTime)}
                      </p>
                      {event.location && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                          <span className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{event.location.name}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
            </div>

            {getEventsForDate(events, selectedDate).filter((e) => e.location).length === 0 && (
              <div className="text-center py-8">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" className="mx-auto mb-2 opacity-40">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>No events with locations for this day</p>
                <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)", opacity: 0.6 }}>
                  Add locations via chat to see them on the map
                </p>
              </div>
            )}

            {getEventsForDate(events, selectedDate).filter((e) => e.location).length >= 2 && isWalkable && (
              <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  <span className="text-[11px] font-medium" style={{ color: "var(--text-primary)" }}>Walking route</span>
                </div>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {routeDuration !== null
                    ? `~${routeDuration} min total walk`
                    : "Calculating route..."}
                </p>
                <a
                  href={(() => {
                    const locs = getEventsForDate(events, selectedDate)
                      .filter((e) => e.location)
                      .map((e) => `${e.location!.lat},${e.location!.lng}`);
                    return `https://www.google.com/maps/dir/${locs.join("/")}`;
                  })()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors w-full"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border-color)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  Open in Google Maps
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          {!process.env.NEXT_PUBLIC_MAPBOX_TOKEN && (
            <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: "var(--bg-secondary)" }}>
              <div className="text-center px-8">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" className="mx-auto mb-3 opacity-40">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Mapbox not configured</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  Add NEXT_PUBLIC_MAPBOX_TOKEN to your .env file to enable the map view.
                </p>
              </div>
            </div>
          )}
          <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />
        </div>
      </div>
    </div>
  );
}
