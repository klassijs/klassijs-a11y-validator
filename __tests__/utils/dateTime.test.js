const { dateTime } = require('../../utils/dateTime');

describe('dateTime utility', () => {
  test('should return a formatted date string', async () => {
    const result = await dateTime();
    
    // Current format: DD-MM-YYYY-HHMMSS + milliseconds (2-3 digits)
    expect(result).toMatch(/^\d{2}-\d{2}-\d{4}-\d{8,9}$/);
  });

  test('should pad single digit values with zeros', async () => {
    // Mock Date to test padding
    const originalDate = Date;
    const mockDate = jest.fn(() => ({
      getDate: () => 5,
      getMonth: () => 2, // March (0-indexed)
      getFullYear: () => 2024,
      getHours: () => 9,
      getMinutes: () => 5,
      getSeconds: () => 3,
      getMilliseconds: () => 7,
    }));
    global.Date = jest.fn(mockDate);

    const result = await dateTime();
    
    // Current implementation pads to at least 2 digits, so 7 -> 07
    expect(result).toBe('05-03-2024-09050307');
    
    global.Date = originalDate;
  });

  test('should handle double digit values correctly', async () => {
    const originalDate = Date;
    const mockDate = jest.fn(() => ({
      getDate: () => 15,
      getMonth: () => 11, // December (0-indexed)
      getFullYear: () => 2024,
      getHours: () => 23,
      getMinutes: () => 59,
      getSeconds: () => 59,
      getMilliseconds: () => 999,
    }));
    global.Date = jest.fn(mockDate);

    const result = await dateTime();
    
    // Should not have extra padding: 15-12-2024-235959999
    expect(result).toBe('15-12-2024-235959999');
    
    global.Date = originalDate;
  });

  test('should include millisecond precision segment', async () => {
    const result = await dateTime();
    const segments = result.split('-');
    const timeSegment = segments[3];
    expect(timeSegment.length).toBeGreaterThanOrEqual(8);
  });
});
