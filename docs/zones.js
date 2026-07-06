// The 13 zone-fund Google Sheets (link-shared). Each sheet has a "Transport" tab
// and a "Sante" (health) tab. The phone only records which zone + type was chosen;
// the secure API fetches that tab as a PDF and attaches it to the transaction.
// Transport uses account 00 (Travel In-field); Sante uses account 51 (Missionary Medical).
window.WORKINGFUND_ZONES = [
  { name: "Aboisso",      id: "1Jp4RffstqgIxuAb4CbBN0ikxA3nQO6tGv_p8J1bfrF4" },
  { name: "Alepe",        id: "1HZcQGjeLpC0F63PWoml_UaLfmwnv1MOCUHW71XvjMng" },
  { name: "Bingerville",  id: "1Jx6putFazFdxYTLYwCoHS3nRQychHltsBN-4-760_PQ" },
  { name: "Bonoua",       id: "1Cs-HVbIG3KN1RkxfGO445p07pwkzPKPbu1fW2feo9Uw" },
  { name: "Cocody",       id: "1-OLP-X8jbQm4NHlGDU7Vj8AkogOyL7HaloJBbYF6pY0" },
  { name: "Dokui",        id: "1NEtjRwH4CRz1zXC5oVfFhvEvyaUDeJs478SoMz0As_U" },
  { name: "Grand-Bassam", id: "1104oolng2z9YJ5A3fkNAisaKl0ICdDIl2wieYtawXRQ" },
  { name: "Koumassi",     id: "1ZC4ksK9xMx56_aTOE_HIXr7NW5eNqk25tapPRac_j3s" },
  { name: "Maffere",      id: "1UKvvKByCMBaI0kgffLnjgSRXqmofp9jfBsa7RdQmY5w" },
  { name: "Port Bouet",   id: "1RUWhBEReDDza_KAOPzttHDLmt6QLklo5ix3-RVn70_Q" },
  { name: "Quatre Etage", id: "1rZkSwu2LYTCCQaPyf3XuhFBksfx6gk7t2yqY9aPFYwI" },
  { name: "Marcory",      id: "1_6O0avBkKAZuhQNURwcmgZq7ha5OLueFN0ImnToYjmQ" },
  { name: "Abobo East",   id: "1cDYRJyi3Sqe5iDITLbDkOghEViAZlj5Z6RRWAexIoWM" },
];
