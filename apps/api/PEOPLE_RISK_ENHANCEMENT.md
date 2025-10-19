# People Risk Calculation Enhancement

## Overview
Enhanced the people risk calculation to incorporate population density as a key factor, recognizing that high-density areas have amplified pollution risks due to their physical layout and concentration effects.

## Key Changes

### 1. Type System Updates (`src/types.ts`)
- Added population density fields to `Site` type:
  - `population_density_km2?`: Population density in people per km²
  - `total_population_affected?`: Total population in affected area
  - `affected_area_km2?`: Size of affected area in km²
- Renamed `proximity` to `people_risk` in `Weights` type for clarity
- Updated `ScoredSite` to include `PeopleRiskScore` instead of proximity
- Enhanced `Maxes` type to include population density and total population maximums

### 2. Population Service Enhancement (`src/routes/population.ts`)
- Added density classification system with thresholds:
  - **Low**: ≤25 people/km² (Rural areas) - 1.0x multiplier
  - **Medium**: ≤100 people/km² (Suburban areas) - 1.2x multiplier  
  - **High**: ≤500 people/km² (Urban areas) - 1.5x multiplier
  - **Very High**: >500 people/km² (Dense urban/metro) - 2.0x multiplier
- Enhanced API response to include:
  - `density_classification`: Categorical density level
  - `risk_multiplier`: Amplification factor for pollution impact
  - `area_km2`: Area in square kilometers
  - Explanatory notes about density impact

### 3. Scoring Service Overhaul (`src/services/scoringService.ts`)
- Created new `calculatePeopleRiskScore()` function that:
  - Normalizes both population density and total population
  - Applies density amplification multipliers (1.0x to 2.0x)
  - Weights density more heavily (70%) than raw population count (30%)
  - Ensures final score remains bounded between 0 and 1
- Updated `defaultWeights` to use `people_risk` instead of `proximity`
- Enhanced `computeMaxes()` to track population density and total population maximums
- Updated both `scoreEmissionsOnly()` and `scoreFused()` functions to use new people risk calculation

### 4. Route Updates
- **Score Route** (`src/routes/score.ts`): Updated weight parsing to use `people_risk`
- **Geo Route** (`src/routes/geo.ts`): Fixed weight parsing and cache key generation
- **Sites Route** (`src/routes/sites.ts`): Updated individual site scoring to use new system
- **Utility Scoring** (`src/util/scoring.ts`): Made consistent with new approach

## Risk Amplification Logic

The new system recognizes that **high-density areas don't just have more people; their physical layout and concentration of activity can actually make pollution worse**:

1. **Concentration Effects**: More people in smaller areas means higher exposure per person
2. **Infrastructure Impact**: Dense urban layouts can trap and concentrate pollutants
3. **Activity Amplification**: High-density areas have more concentrated industrial/traffic activity

### Risk Multipliers
- **1.0x**: Rural areas (≤25 people/km²)
- **1.2x**: Suburban areas (26-100 people/km²) 
- **1.5x**: Urban areas (101-500 people/km²)
- **2.0x**: Very high density (>500 people/km²)

## API Compatibility
- Maintains backward compatibility by supporting legacy `wP` parameter for people risk weight
- All existing endpoints continue to work with enhanced scoring
- Population endpoint now provides additional context about density impacts

## Usage Example

When calling the population estimation endpoint:
```json
{
  "source": "WorldPop",
  "total_population": 12500,
  "density_per_km2": 425,
  "density_classification": "high",
  "risk_multiplier": 1.5,
  "note": "Higher density areas have increased pollution impact due to concentration effects and physical layout"
}
```

The risk calculation now properly accounts for the amplified impact that pollution has in high-density environments.