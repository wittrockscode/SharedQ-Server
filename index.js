const axios = require("axios")
const constants = require("./common/constants")
const {calcNextSong, addNextSongToSpotify, getSpotifyDevices} = require("./common/functions")
const db = require("./db")
const WSServer = require("ws").Server
const {WebSocket} = require("ws")

const server = require("http").createServer()
const app = require("./express-server")

const wss = new WSServer({server: server});
server.on('request', app);



require("./routes/spotify/spotify-routes")(app, db)
require("./routes/sharedq/session-routes")(app, db)
require("./routes/sharedq/vote-routes")(app, db, wss, WebSocket)
require("./routes/sharedq/queue-routes")(app, db, wss, WebSocket)


wss.on('connection', function connection(ws) {
 
    ws.on('message', function incoming(message) {
      
      console.log(`received: ${message}`);
      
      ws.send(JSON.stringify({
  
        pong: true
      }));
    });
});




const pollSessions = () => {

    //Get all sessions within the last 12 hours
    db.query("SELECT session_id, spotify_auth_token, spotify_refresh_token, time_created, queue, next_song FROM sessions AS Users WHERE Users.time_created >= NOW() - INTERVAL '12 HOURS';", (error, result) => {
        if(error){
            console.log(error.stack)
            console.log("ERRORRRR")
        }
        const sessions = []
        for(let i = 0; i < result.rows.length; i++){
            sessions.push(result.rows[i])
        }
        
        //Iterate through all sessions
        sessions.forEach(session => {
            const config = {
                headers: { Authorization: `Bearer ${session.spotify_auth_token}` }
            };

            //Check if the next song exists
            if(session.next_song !== undefined && session.next_song !== null){
                axios.get("https://api.spotify.com/v1/me/player/queue", config).then(res => {
                    const spotify_queue = res.data.queue
                    console.log("Hkdjgbfhlkisjhgbolsfhdgoöisdjfhgoipöshfgdoöisfdhgöoishdg")
                    //Check if the next song is not in the queue anymore
                    if(spotify_queue.filter(elem => elem.id === session.next_song.song_id).length === 0){
                        //NEXT SONG NOT IN QUEUE
                        if(session.queue.length > 0){
                            //Calculate and add the new next song
                            const {newQueue, newNextSong} = calcNextSong(session.queue)
                            const text = "UPDATE sessions SET queue = $1, next_song = $2 WHERE session_id = $3;"
                            const values = [JSON.stringify(newQueue), newNextSong, session.session_id]
                            db.query(text, values, (error2, result2) => {
                                if(error2){
                                    console.log("ERROR2")
                                    console.log(error2.stack)
                                }else{
                                    //add to spotify queue
                                    addNextSongToSpotify(newNextSong.uri, session.spotify_auth_token, wss, WebSocket)

                                }
                            })
                        }else{
                            //No next song to add, remove the current next song
                            if(session.next_song !== undefined && session.next_song !== null){
                                const text = "UPDATE sessions SET next_song = $1 WHERE session_id = $2;"
                                const values = [null, session.session_id]
                                db.query(text, values, (error2, result2) => {
                                    if(error2){
                                        console.log("clear next song error:")
                                        console.log(error2.stack)
                                    }else{
                                        console.log("next song cleared")
                                        wss.clients.forEach(client => {
                                            if(client.readyState === WebSocket.OPEN){
                                                client.send(JSON.stringify({update: true}))
                                            }
                                        })
                                    }
                                })
                            }
                        }
                    }else{
                        //Next song is still in the queue
                        console.log("IN QUEUE")
                    }
                    

                }).catch(err => {
                    //Spotify error
                    console.log(err)
                    if(err.response){
                        if(err.response.status === 401){
                            //The access token has expired, generate a new one
                            const body = {
                                grant_type: "refresh_token",
                                refresh_token: session.spotify_refresh_token
                            }
                            axios.post("https://accounts.spotify.com/api/token", new URLSearchParams(body), {headers:{'Content-Type': 'application/x-www-form-urlencoded',
                            'Authorization': 'Basic ' + Buffer.from(constants.client_id + ':' + constants.client_secret).toString('base64')}}).then(response2 => {
                                db.query(`UPDATE sessions SET spotify_auth_token = '${response2.data.access_token}' WHERE session_id = '${session.session_id}';`, (error, result) => {
                                    if(error){
                                        console.log("Database error")
                                    }else{
                                        console.log("error2")
                                        pollSessions()
                                    }
                                })
                                
                            }).catch(err => {
                                console.log("error13")
                            })
                        }
                    }else{
                        console.log(err)
                    }
                    
                })
            }
        })
        
    })
}

app.get("/api/test", (req, res) => {
    console.log("GET /api/test")
    console.log("test")
    res.status(200).json("ok")
})



setInterval(() => {
    pollSessions()
}, 30000)


pollSessions()


server.listen(constants.PORT, constants.LOCAL_URL, () => {console.log(`Listening at ${constants.LOCAL_URL} on ${constants.PORT_STRING}`)})