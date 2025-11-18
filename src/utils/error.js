function formatAxiosError(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (error.response) {
    const {status, statusText, data, headers} = error.response;
    const contentType = headers?.['content-type'] || headers?.['Content-Type'];

    const looksLikeHtml =
      typeof data === 'string' &&
      (/<html/i.test(data) || /<!DOCTYPE/i.test(data) || /<body/i.test(data));

    let details;
    if (looksLikeHtml || (typeof contentType === 'string' && contentType.includes('text/html'))) {
      const titleMatch =
        typeof data === 'string' ? data.match(/<title>([^<]*)<\/title>/i) : null;
      const title = titleMatch?.[1]?.trim();
      const length = typeof data === 'string' ? data.length : 0;
      details = `HTML response${title ? ` (title="${title}")` : ''} length=${length}`;
    } else {
      const rawDetails = typeof data === 'string' ? data : JSON.stringify(data);
      details =
        typeof rawDetails === 'string' && rawDetails.length > 200
          ? `${rawDetails.slice(0, 200)}…`
          : rawDetails;
    }

    return `HTTP ${status} ${statusText || ''} - ${details}`.trim();
  }

  if (error.request) {
    return 'No response received from remote server';
  }

  if (error.message) {
    return error.message;
  }

  return String(error);
}

module.exports = {formatAxiosError};
