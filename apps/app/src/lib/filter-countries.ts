import type { CountryData } from "country-region-data"

// CountryData is a tuple: [CountryName, CountrySlug, Region[]]
// Region is a tuple: [RegionName, RegionSlug]

export interface CountryRegion {
  countryName: string
  countryShortCode: string
}

export const filterCountries = (
  countries: CountryData[],
  priorityCountries: string[],
  whitelist: string[],
  blacklist: string[]
): CountryRegion[] => {
  // Convert tuples to objects for easier handling
  const mapped = countries.map(([name, code]) => ({
    countryName: name,
    countryShortCode: code,
  }))

  const countriesListedFirst: CountryRegion[] = []
  let filteredCountries = mapped

  if (whitelist.length > 0) {
    filteredCountries = mapped.filter(
      ({ countryShortCode }) => whitelist.indexOf(countryShortCode) > -1
    )
  } else if (blacklist.length > 0) {
    filteredCountries = mapped.filter(
      ({ countryShortCode }) => blacklist.indexOf(countryShortCode) === -1
    )
  }

  if (priorityCountries.length > 0) {
    // ensure the countries are added in the order in which they are specified by the user
    for (const slug of priorityCountries) {
      const result = filteredCountries.find(({ countryShortCode }) => countryShortCode === slug)
      if (result) {
        countriesListedFirst.push(result)
      }
    }

    filteredCountries = filteredCountries.filter(
      ({ countryShortCode }) => priorityCountries.indexOf(countryShortCode) === -1
    )
  }

  return countriesListedFirst.length
    ? [...countriesListedFirst, ...filteredCountries]
    : filteredCountries
}
