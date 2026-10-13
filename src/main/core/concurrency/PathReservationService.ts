type Reservation = { paths: readonly string[]; overlaps: (candidate: string) => boolean }

/** Process-local path scopes, released by their owning operation on every terminal path. */
class PathReservationService {
  private readonly reservations = new Set<Reservation>()

  isReserved(candidate: string): boolean {
    return [...this.reservations].some((reservation) => reservation.overlaps(candidate))
  }

  tryReserve(paths: readonly string[], overlaps: Reservation['overlaps']): (() => void) | undefined {
    if (
      paths.some((candidate) => this.isReserved(candidate)) ||
      [...this.reservations].some((reservation) => reservation.paths.some(overlaps))
    )
      return undefined
    const reservation = { paths, overlaps }
    this.reservations.add(reservation)
    return () => {
      this.reservations.delete(reservation)
    }
  }
}

export const pathReservationService = new PathReservationService()
