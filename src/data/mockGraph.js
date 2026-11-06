export const mockGraph = {
  nodes: {
    "terminal": { lat: -17.6320, lng: -71.3340, name: "Terminal Terrestre" },
    "unam": { lat: -17.6394, lng: -71.3375, name: "UNAM Filial Ilo" },
    "pza_armas": { lat: -17.6410, lng: -71.3390, name: "Plaza de Armas" },
    "puerto": { lat: -17.6445, lng: -71.3412, name: "Puerto de Ilo" }
  },
  edges: {
    "terminal": [
      { target: "unam", weight: 0.90, oneWay: false },
      { target: "puerto", weight: 1.50, oneWay: false }
    ],
    "unam": [
      { target: "terminal", weight: 0.90, oneWay: false },
      { target: "pza_armas", weight: 0.45, oneWay: false }
    ],
    "pza_armas": [
      { target: "unam", weight: 0.45, oneWay: false },
      { target: "puerto", weight: 0.50, oneWay: false }
    ],
    "puerto": [
      { target: "terminal", weight: 1.50, oneWay: false },
      { target: "pza_armas", weight: 0.50, oneWay: false }
    ]
  }
};