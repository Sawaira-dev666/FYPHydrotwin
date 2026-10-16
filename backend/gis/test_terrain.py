from terrain import extract_terrain_features


# Example location
latitude = 32.1877
longitude = 74.1945


result = extract_terrain_features(
    latitude,
    longitude
)

print("Terrain result:")
print(result)