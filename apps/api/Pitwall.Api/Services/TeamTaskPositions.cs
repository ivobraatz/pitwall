namespace Pitwall.Services;

/// <summary>
/// Order inside a board column. Positions are fractional: a card dropped between two others takes
/// the midpoint, so a move rewrites one row. When repeated drops in the same spot wear the gap
/// down, the column is renumbered once and the midpoint taken again.
/// </summary>
public static class TeamTaskPositions
{
    public const double Step = 1024;
    /// <summary>Below this the midpoint no longer sits reliably between its neighbours.</summary>
    public const double MinGap = 1e-6;

    /// <summary>Above the first card; <paramref name="min"/> null = empty column.</summary>
    public static double Top(double? min) => min is { } m ? m - Step : Step;

    /// <summary>Below the last card; <paramref name="max"/> null = empty column.</summary>
    public static double Bottom(double? max) => max is { } m ? m + Step : Step;

    public static double Between(double a, double b) => a + (b - a) / 2;

    public static bool NeedsReindex(double a, double b) => Math.Abs(b - a) < MinGap;

    /// <summary>
    /// Where a card goes given the card that ends up above it and the one below it (either may be
    /// missing). Null when there is no room between them: renumber the column and ask again.
    /// </summary>
    public static double? Place(double? above, double? below) => (above, below) switch
    {
        (null, null) => Step,
        (null, { } b) => Top(b),
        ({ } a, null) => Bottom(a),
        ({ } a, { } b) => NeedsReindex(a, b) ? null : Between(a, b),
    };

    /// <summary>The fresh numbering of a column of <paramref name="count"/> cards: 1024, 2048, …</summary>
    public static double[] Renumber(int count) => Enumerable.Range(1, count).Select(i => i * Step).ToArray();
}
