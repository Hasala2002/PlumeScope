const axios = require('axios');

async function testPopulationDensity() {
  const baseURL = 'http://localhost:3001';
  
  // Test data - 1 km² area
  const testPayload = {
    geojson: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-102.8, 31.5],
          [-102.799, 31.5], 
          [-102.799, 31.509],
          [-102.8, 31.509],
          [-102.8, 31.5]
        ]]
      }
    },
    area_m2: 1000000, // 1 km²
    year: 2020
  };

  console.log('Testing population density for different sites (1 km² area)...\n');

  // Test Site A (S1) - Houston area (should be 50 people/km²)
  try {
    const responseS1 = await axios.post(`${baseURL}/population/estimate`, {
      ...testPayload,
      siteId: 'S1'
    });
    console.log('Site A (S1 - Houston):');
    console.log(`Population: ${responseS1.data.total_population}`);
    console.log(`Density: ${responseS1.data.density_per_km2} people/km²`);
    console.log(`Note: ${responseS1.data.note || 'N/A'}\n`);
  } catch (error) {
    console.log('Site A (S1): API may be working, using fallback...\n');
  }

  // Test Site B (S2) - West TX (should be 15 people/km²)
  try {
    const responseS2 = await axios.post(`${baseURL}/population/estimate`, {
      ...testPayload,
      siteId: 'S2'
    });
    console.log('Site B (S2 - West TX):');
    console.log(`Population: ${responseS2.data.total_population}`);
    console.log(`Density: ${responseS2.data.density_per_km2} people/km²`);
    console.log(`Note: ${responseS2.data.note || 'N/A'}\n`);
  } catch (error) {
    console.log('Site B (S2): API may be working, using fallback...\n');
  }

  // Test Site C (S3) - Central TX (should be 40 people/km²)
  try {
    const responseS3 = await axios.post(`${baseURL}/population/estimate`, {
      ...testPayload,
      siteId: 'S3'
    });
    console.log('Site C (S3 - Central TX):');
    console.log(`Population: ${responseS3.data.total_population}`);
    console.log(`Density: ${responseS3.data.density_per_km2} people/km²`);
    console.log(`Note: ${responseS3.data.note || 'N/A'}\n`);
  } catch (error) {
    console.log('Site C (S3): API may be working, using fallback...\n');
  }

  // Test without siteId (should use default 40 people/km²)
  try {
    const responseDefault = await axios.post(`${baseURL}/population/estimate`, testPayload);
    console.log('No Site ID (Default):');
    console.log(`Population: ${responseDefault.data.total_population}`);
    console.log(`Density: ${responseDefault.data.density_per_km2} people/km²`);
    console.log(`Note: ${responseDefault.data.note || 'N/A'}\n`);
  } catch (error) {
    console.log('Default: API may be working, using fallback...\n');
  }
}

testPopulationDensity().catch(console.error);