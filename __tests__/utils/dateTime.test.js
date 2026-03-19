const { dateTime } = require('../../utils/dateTime');

describe('dateTime utility', () => {
  test('should return a formatted date string', async () => {
    const result = await dateTime();
    
    // Should match format: DD-MM-YYYY-HHMMSSmmm
    expect(result).toMatch(/^\d{2}-\d{2}-\d{4}-\d{9}$/);
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
    
    // Should have padded zeros: 05-03-2024-090503007
    expect(result).toBe('05-03-2024-090503007');
    
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

  test('should return a unique timestamp on each call', async () => {
    const result1 = await dateTime();
    // Small delay to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 10));
    const result2 = await dateTime();
    
    expect(result1).not.toBe(result2);
  });
});
