$(() => {
    const supportEmail = 'support@z-lib.do'
    const domains = {
        staticList: [
            'https://singlelogin.re',
            'https://z-library.rs',
            'https://z-library.do',
            'https://z-lib.gs',
            'https://z-lib.gd',
            'https://z-lib.do',
            'https://z-lib.fm',
        ],
        getLastAvailableDomain: () => {
            return chrome.storage.local.get(['availableDomain']).then(result => result.availableDomain);
        },
        getAll: async () => {
            try {
                const result = await chrome.storage.local.get(['allDomains']);
                const list = result.allDomains ? JSON.parse(result.allDomains) : [];
                if (Array.isArray(list) && list.length) {
                    for (let domain of domains.staticList) {
                        if (list.indexOf(domain) === -1) {
                            list.push(domain)
                        }
                    }
                    return list
                }
            } catch (error) {}

            return Array.from(domains.staticList)
        },
        updateList: async (availableDomain, callback) => {
            try {
                const currentTimestamp = Math.ceil((new Date().getTime() / 1000))
                const result = await chrome.storage.local.get(['lastUpdate']);
                const lastUpdate = parseInt(result.lastUpdate);
                
                if (isNaN(lastUpdate) || (currentTimestamp - lastUpdate) > 86400) {
                    await chrome.storage.local.set({ lastUpdate: currentTimestamp.toString() });
                } else {
                    return callback()
                }
            } catch (error) {}

            // update domains
            const url = availableDomain + '/eapi/info/domains'
            $.ajax({
                url: url,
                timeout: 7000,
            }).done(async (result) => {
                let list = Array.from(domains.staticList)
                if (result !== null && typeof result === 'object' && result.domains) {
                    for (let row of result.domains) {
                        if (row !== null && typeof row === 'object' && row.domain) {
                            list.push('https://' + row.domain)
                        }
                    }
                }
                list = list.filter(function(itm, i, a) {
                    return i === list.indexOf(itm)
                })
                await chrome.storage.local.set({ allDomains: JSON.stringify(list) });
                callback()
            }).fail(()=> {
                callback()
            })
        }
    }

    const domainsChecker = {
        stop: false,
        checkDomainTimeout: 15, // sec
        checkInParts: 5,
        checkInPartsDelay: 7, // sec
        processes: {
            list: {},
            add: (domain) => {
                domainsChecker.processes.list[domain] = 'start'
            },
            setAsCompleted: (domain) => {
                if (domainsChecker.processes.list[domain]) {
                    domainsChecker.processes.list[domain] = 'completed'
                }
            },
            clear: () => {
                domainsChecker.processes.list = {}
            },
            isEmpty: () => {
                for (let i in domainsChecker.processes.list) {
                    if (domainsChecker.processes.list[i] === 'start') {
                        return false
                    }
                }
                return true
            }
        },
        results: {
            availableDomain: null,
        },
        run: (sendResponse) => {
            if (domainsChecker.stop) {
                return
            }

            // fill processes
            domainsChecker.processes.clear()
            let domainsOriginal = domains.getAll()
            for (let domain of domainsOriginal) {
                domainsChecker.processes.add(domain)
            }

            // slice domains and create queue
            let domainsPart
            let counter = 0
            while (domainsPart = domainsOriginal.splice(0, domainsChecker.checkInParts)) {
                if (!domainsPart.length) {
                    break;
                }
                setTimeout((list) => {
                    for (let domain of list) {
                        domainsChecker.checkDomain(domain, (isAvailable) => {
                            if (domainsChecker.stop) {
                                return
                            }
                            if (!isAvailable && domainsChecker.processes.isEmpty()) {
                                return sendResponse(domainsChecker.results)
                            }
                            if (isAvailable && !domainsChecker.results.availableDomain) {
                                domainsChecker.stop = true
                                domainsChecker.results.availableDomain = domain
                                return sendResponse(domainsChecker.results)
                            }
                        })
                    }
                }, counter * domainsChecker.checkInPartsDelay * 1000, Array.from(domainsPart))
                counter += 1
            }
        },
        checkDomain: (domain, callback) => {
            if (domainsChecker.stop) {
                return
            }
            let url = domain + '/p/index.php?v=' + new Date().getTime()
            $.ajax({
                url: url,
                timeout: domainsChecker.checkDomainTimeout * 1000,
                crossDomain: true,
            }).done((data, g, resp) => {
                domainsChecker.processes.setAsCompleted(domain)
                callback((resp.status === 200 && resp.responseText.length > 0))
            }).fail((data, g, resp) => {
                domainsChecker.processes.setAsCompleted(domain)
                callback(false)
            })
        },
        processResult: async (result) => {
            const availableDomain = (result || {}).availableDomain
            if (availableDomain) {
                await chrome.storage.local.set({ availableDomain: availableDomain });
                domains.updateList(availableDomain, () => {
                    domainsChecker.saveMetric(availableDomain, () => {
                        chrome.tabs.create({url: availableDomain});
                        window.close()
                    })
                })
            } else {
                $('.loading').addClass('hidden')
                $('.no-available-domains #supportEmail').attr('href', `mailto:${supportEmail}`).text(supportEmail)
                $('.no-available-domains').removeClass('hidden')
            }
        },
        // metric for redirects
        saveMetric: (availableDomain, callback) => {
            const url = availableDomain + '/eapi/system/metric'
            $.ajax({
                url: url,
                method: 'POST',
                data: {'name': 'BrowserExtensionRedirect', 'value': 1, 'tags': {'extension': 'firefox'}},
                timeout: 7000,
            }).done(() => {
                callback()
            }).fail(()=> {
                callback()
            })
        }
    }

    const lastAvailableDomain = domains.getLastAvailableDomain()
    if (lastAvailableDomain) {
        domainsChecker.checkDomain(lastAvailableDomain, (isAvailable) => {
            if (isAvailable) {
                domainsChecker.results.availableDomain = lastAvailableDomain
                domainsChecker.processResult(domainsChecker.results)
            } else {
                domainsChecker.run(domainsChecker.processResult)
            }
        })
    } else {
        domainsChecker.run(domainsChecker.processResult)
    }
})