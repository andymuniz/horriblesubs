import * as hs from "./horriblesubs";
import { config } from "./horriblesubs_config";
import feedparser from "feedparser-promised";
import { promises as fs } from 'fs';

const hs_uri = 'https://horriblesubs.info/rss.php?res=';

(async function () {
    await hs.init_deluge();
    await hs.init_pushbullet();

    let feed = await feedparser.parse(hs_uri + config.video_res);
    if (feed.length > 0)
        console.log('Feed retrieved! ', feed.length, ' items');

    let unrenamed_torrents = {},
        new_episodes = [];

    for (let item of feed) {
        let match = item.title.match(/(?:\[HorribleSubs\]\s+)(?<show>.+)(?:\s-\s+)(?<num>\d+)(?:\s+\[\d+p\])(?<ext>\.\w+)/);
        if (!match) continue;

        for (let show of config.my_shows) {
            // if this show is on our list
            let name = show['name'];

            if (name === match.groups.show) {
                let local_name = show.hasOwnProperty('local_name') ? show['local_name'] : name;

                // we don't want to download half-episodes
                if (match.groups.num.endsWith('.5')) {
                    console.log('SKIPPING HALF EPISODE');
                    break;
                }

                // HorribleSubs returns absolute ep #; we convert to season+ep #s
                let episode = match.groups.num;
                let season = 1;
                if (show.hasOwnProperty('season_lengths')) {
                    for (let sl in show['season_lengths']) {
                        if (sl < episode) {
                            episode -= sl;
                            season += 1;
                        }
                        else
                            break;
                    }
                }

                let out_dir = config.media_folder + '/' + local_name + '/' + 'Season ' + season,
                    out_file = local_name + ' - s' + season.toString().padStart(2, '0') + 'e' + episode.padStart(2, '0') + match.groups.ext,
                    out = out_dir + '/' + out_file;

                // create the output folder if it's absent
                await fs.lstat(out_dir)
                    .catch(async () => {
                        console.log('Directory does not exist...');
                        await fs.mkdir(out_dir, config.chmod)
                            .then(() => console.log('Created directory:  ', out_dir))
                            .catch((error) => {
                                console.log("Error occured while creating directory: ", out_dir);
                                console.log(error);
                            });
                    });

                // verify the file doesn't already exist
                await fs.lstat(out)
                    .then(() => console.log('File (' + out_file + ') ' + 'already exists...'))
                    .catch(async () => {
                        // RPC method: add_torrent_url(url, options, headers=none)
                        let torrent_id = await hs.deluge_call('core.add_torrent_magnet', [item.link, { download_location: out_dir }])
                            .then(() => console.log('Torrent starting...'))
                            .catch(console.log);
                        new_episodes.push(local_name);

                        unrenamed_torrents[torrent_id] = out_file;
                    });
            }
        }

    }

    // send notifications if we got any new episodes
    if (new_episodes.length > 0) {
        let notif_body = 'Shows: ';
        for (let show of new_episodes) {
            notif_body += show + ', '
        }
        notif_body = notif_body.substring(0, notif_body.length - 2);
        hs.send_notification('New eps of ' + new_episodes.length + ' shows', notif_body);
    }

    // we can't rename the files until Deluge has downloaded the metadata and
    // discovered the files, so we just have to keep polling for a bit
    let tries = 0;
    if (Object.keys(unrenamed_torrents).length > 0) {
        let intervalID = setInterval(async function () {
            unrenamed_torrents = await hs.attempt_file_rename(unrenamed_torrents);
            tries += 1;
            console.log('Attempting to rename file. Try ', tries);
            if (tries > 10) {
                console.log('ERROR: Took too long to rename ' + unrenamed_torrents.length + ' torrents, giving up.')
                clearInterval(intervalID);
            } else if (Object.keys(unrenamed_torrents).length <= 0) {
                console.log('File successfully renamed.');
                clearInterval(intervalID);
            }
        }, 3000);
    }
})();

