# Seeding

Database seeding system for populating initial/builtin data on app startup.

## Documentation

See [Database Seeding Guide](../../../../docs/references/data/database-seeding-guide.md) for full documentation.

## Quick Reference

To add a new seeder:
1. Create a class implementing `ISeeder` in this directory
2. Add it to the `seeders` array in `index.ts`
