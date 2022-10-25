export default (len = 32) => {
  const buf = [];
  const chars = 'abcdef0123456789';

  for (let i = 0; i < len; i++) {
    buf[i] = chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return buf.join('');
};
