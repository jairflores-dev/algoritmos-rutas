export const iloGraph = {
  nodes: {
    "terminal": { lat: -17.6258, lng: -71.3295, name: "Terminal Terrestre Ilo" },
    "pampa_inalambrica": { lat: -17.6315, lng: -71.3185, name: "Pampa Inalámbrica" },
    "caceres": { lat: -17.6350, lng: -71.3325, name: "Av. Andrés Avelino Cáceres" },
    "miramar": { lat: -17.6390, lng: -71.3370, name: "Urb. Miramar" },
    "malecon": { lat: -17.6435, lng: -71.3425, name: "Malecón Costero" },
    "pza_armas": { lat: -17.6455, lng: -71.3435, name: "Plaza de Armas de Ilo" },
    "puerto": { lat: -17.6492, lng: -71.3460, name: "Puerto de Ilo (ENAPU)" },
    "unam_ilo": { lat: -17.6542, lng: -71.3465, name: "UNAM Filial Ilo (EPISI)" }
  },
  edges: {
    "terminal": [
      { target: "pampa_inalambrica", weight: 1.4, oneWay: false },
      { target: "caceres", weight: 1.1, oneWay: false }
    ],
    "pampa_inalambrica": [
      { target: "terminal", weight: 1.4, oneWay: false },
      { target: "miramar", weight: 1.8, oneWay: false }
    ],
    "caceres": [
      { target: "terminal", weight: 1.1, oneWay: false },
      { target: "miramar", weight: 0.6, oneWay: false }
    ],
    "miramar": [
      { target: "caceres", weight: 0.6, oneWay: false },
      { target: "pampa_inalambrica", weight: 1.8, oneWay: false },
      { target: "malecon", weight: 0.8, oneWay: false }
    ],
    "malecon": [
      { target: "miramar", weight: 0.8, oneWay: false },
      { target: "pza_armas", weight: 0.3, oneWay: false }
    ],
    "pza_armas": [
      { target: "malecon", weight: 0.3, oneWay: false },
      { target: "puerto", weight: 0.5, oneWay: false }
    ],
    "puerto": [
      { target: "pza_armas", weight: 0.5, oneWay: false },
      { target: "unam_ilo", weight: 0.6, oneWay: false }
    ],
    "unam_ilo": [
      { target: "puerto", weight: 0.6, oneWay: false }
    ]
  }
};